import { createHash } from "node:crypto";
import { initializeApp } from "firebase-admin/app";
import { FieldPath, FieldValue, getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { onRequest } from "firebase-functions/v2/https";
import { logger } from "firebase-functions";

initializeApp();

const db = getFirestore();
const auth = getAuth();
const USERS_COLLECTION = "users";
const PUBLIC_USERS_COLLECTION = "publicUsers";
const BANNED_USERS_COLLECTION = "bannedUsers";
const MAX_PAGE_SIZE = 50;
const DEFAULT_PAGE_SIZE = 24;
const allowedOrigins = new Set([
  "https://physicalnumbers.github.io",
  "http://localhost:8766",
  "http://127.0.0.1:8766"
]);

function publicProfileId(uid) {
  return createHash("sha256").update(uid).digest("base64url");
}

function cleanString(value, maximumLength = 0) {
  if (typeof value !== "string") {
    return "";
  }
  return maximumLength ? value.slice(0, maximumLength) : value;
}

function profileProjection(data) {
  return {
    nickname: cleanString(data.nickname).trim()
      || cleanString(data.googleName).trim()
      || "Пользователь",
    description: cleanString(data.description, 500).trim(),
    avatarUrl: cleanString(data.avatarUrl)
      || cleanString(data.avatarDataUrl)
  };
}

async function syncPublicProfile(uid, profileData) {
  const publicRef = db.collection(PUBLIC_USERS_COLLECTION).doc(publicProfileId(uid));
  const banSnapshot = await db.collection(BANNED_USERS_COLLECTION).doc(uid).get();
  if (!profileData || banSnapshot.exists) {
    await publicRef.delete();
    return;
  }
  await publicRef.set({
    ...profileProjection(profileData),
    uid
  });
}

export const syncUserPublicProfile = onDocumentWritten(
  `${USERS_COLLECTION}/{uid}`,
  async (event) => {
    const uid = event.params.uid;
    await syncPublicProfile(
      uid,
      event.data?.after.exists ? event.data.after.data() : null
    );
  }
);

function applyCors(request, response) {
  const origin = request.get("origin");
  if (origin && allowedOrigins.has(origin)) {
    response.set("Access-Control-Allow-Origin", origin);
    response.set("Vary", "Origin");
  }
  response.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  response.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
  response.set("Access-Control-Max-Age", "3600");
  if (request.method === "OPTIONS") {
    response.status(204).end();
    return false;
  }
  return true;
}

function sendError(response, status, message) {
  response.status(status).json({ error: message });
}

function isTokenError(error) {
  return typeof error.code === "string" && error.code.startsWith("auth/");
}

async function getCaller(request) {
  const authorization = request.get("authorization") || "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return null;
  }
  return auth.verifyIdToken(match[1], true);
}

function isAdmin(caller) {
  return Boolean(caller && caller.admin === true);
}

function readPageSize(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return DEFAULT_PAGE_SIZE;
  }
  return Math.min(parsed, MAX_PAGE_SIZE);
}

function serializePublicProfile(profileSnapshot, admin, isBanned = false, isCreator = false) {
  const profile = profileSnapshot.data() || {};
  return {
    id: profileSnapshot.id,
    ...profileProjection(profile),
    isCreator,
    ...(admin ? { uid: profile.uid, isBanned } : {})
  };
}

export const publicUsers = onRequest(
  { region: "us-central1" },
  async (request, response) => {
    if (!applyCors(request, response)) {
      return;
    }
    if (request.method !== "GET") {
      response.set("Allow", "GET, OPTIONS");
      sendError(response, 405, "Method not allowed.");
      return;
    }

    try {
      const caller = await getCaller(request);
      const admin = isAdmin(caller);
      const ownerSnapshot = await db.collection("siteSettings").doc("owner").get();
      const ownerUid = ownerSnapshot.exists ? ownerSnapshot.get("uid") : "";
      const profileId = request.query.id;

      if (typeof profileId === "string" && profileId.length > 0) {
        if (!/^[A-Za-z0-9_-]{43}$/.test(profileId)) {
          sendError(response, 400, "Invalid profile id.");
          return;
        }
        const profileSnapshot = await db
          .collection(PUBLIC_USERS_COLLECTION)
          .doc(profileId)
          .get();
        if (!profileSnapshot.exists) {
          if (admin) {
            const banned = await db.collection(BANNED_USERS_COLLECTION)
              .where("profileId", "==", profileId)
              .limit(1)
              .get();
            if (!banned.empty) {
              const uid = banned.docs[0].id;
              const privateProfile = await db.collection(USERS_COLLECTION).doc(uid).get();
              if (privateProfile.exists) {
                response.json({
                  user: serializePublicProfile(
                    { id: profileId, data: () => privateProfile.data() },
                    true,
                    true,
                    uid === ownerUid
                  ),
                  isAdmin: true
                });
                return;
              }
            }
          }
          sendError(response, 404, "Profile not found.");
          return;
        }
        const profile = profileSnapshot.data();
        const bannedSnapshot = admin
          ? await db.collection(BANNED_USERS_COLLECTION).doc(profile.uid).get()
          : null;
        response.json({
          user: serializePublicProfile(
            profileSnapshot,
            admin,
            Boolean(bannedSnapshot?.exists),
            profile.uid === ownerUid
          ),
          isAdmin: admin
        });
        return;
      }

      const pageSize = readPageSize(request.query.pageSize);
      let query = db.collection(PUBLIC_USERS_COLLECTION)
        .orderBy(FieldPath.documentId())
        .limit(pageSize);
      const pageToken = request.query.pageToken;
      if (typeof pageToken === "string" && pageToken.length > 0) {
        if (!/^[A-Za-z0-9_-]{43}$/.test(pageToken)) {
          sendError(response, 400, "Invalid page token.");
          return;
        }
        const cursor = await db.collection(PUBLIC_USERS_COLLECTION).doc(pageToken).get();
        if (!cursor.exists) {
          sendError(response, 400, "Page token expired.");
          return;
        }
        query = query.startAfter(cursor);
      }

      const page = await query.get();
      const users = await Promise.all(page.docs.map(async (document) => {
        const data = document.data();
        const creatorId = ownerUid ? publicProfileId(ownerUid) : "";
        if (document.id === creatorId) {
          return null;
        }
        if (!admin) {
          return serializePublicProfile(document, false, false, data.uid === ownerUid);
        }
        const ban = await db.collection(BANNED_USERS_COLLECTION).doc(data.uid).get();
        return serializePublicProfile(document, true, ban.exists, data.uid === ownerUid);
      }));
      if (!pageToken && ownerUid) {
        const creatorProfile = await db.collection(PUBLIC_USERS_COLLECTION)
          .doc(publicProfileId(ownerUid))
          .get();
        if (creatorProfile.exists) {
          users.unshift(serializePublicProfile(creatorProfile, admin, false, true));
        }
      }
      const last = page.docs.at(-1);
      response.json({
        users: users.filter(Boolean),
        nextPageToken: page.size === pageSize ? last.id : null,
        isAdmin: admin
      });
    } catch (error) {
      logger.error("Could not serve public user profiles.", error);
      sendError(
        response,
        isTokenError(error) ? 401 : 500,
        isTokenError(error) ? "The Firebase sign-in token is invalid or expired." : "Could not load user profiles."
      );
    }
  }
);

export const moderateUser = onRequest(
  { region: "us-central1" },
  async (request, response) => {
    if (!applyCors(request, response)) {
      return;
    }
    if (request.method !== "POST") {
      response.set("Allow", "POST, OPTIONS");
      sendError(response, 405, "Method not allowed.");
      return;
    }

    try {
      const caller = await getCaller(request);
      if (!isAdmin(caller)) {
        sendError(response, 403, "Administrator permission required.");
        return;
      }
      const { action, targetUid } = request.body || {};
      if (
        !["ban", "unban"].includes(action)
        || typeof targetUid !== "string"
        || targetUid.length < 1
        || targetUid.length > 128
        || targetUid.includes("/")
      ) {
        sendError(response, 400, "Invalid moderation request.");
        return;
      }
      if (targetUid === caller.uid) {
        sendError(response, 400, "You cannot moderate your own account.");
        return;
      }

      const target = await auth.getUser(targetUid);
      const ownerSnapshot = await db.collection("siteSettings").doc("owner").get();
      if (
        target.customClaims?.admin === true
        || (ownerSnapshot.exists && ownerSnapshot.get("uid") === targetUid)
      ) {
        sendError(response, 403, "Administrator accounts cannot be moderated here.");
        return;
      }

      const banRef = db.collection(BANNED_USERS_COLLECTION).doc(targetUid);
      const profileRef = db.collection(USERS_COLLECTION).doc(targetUid);
      const publicRef = db.collection(PUBLIC_USERS_COLLECTION).doc(publicProfileId(targetUid));

      if (action === "ban") {
        const existingBan = await banRef.get();
        if (existingBan.exists) {
          sendError(response, 409, "This account is already blocked.");
          return;
        }
        await banRef.set({
          profileId: publicProfileId(targetUid),
          moderatorUid: caller.uid,
          wasDisabled: target.disabled,
          updatedAt: FieldValue.serverTimestamp()
        });
        await auth.updateUser(targetUid, { disabled: true });
        await auth.revokeRefreshTokens(targetUid);
        await publicRef.delete();
        response.json({ success: true, action: "ban" });
        return;
      }

      const banSnapshot = await banRef.get();
      if (!banSnapshot.exists) {
        sendError(response, 404, "This account is not blocked.");
        return;
      }
      const wasDisabled = banSnapshot.get("wasDisabled") === true;
      await auth.updateUser(targetUid, { disabled: wasDisabled });
      await auth.revokeRefreshTokens(targetUid);
      await banRef.delete();
      const profileSnapshot = await profileRef.get();
      await syncPublicProfile(targetUid, profileSnapshot.exists ? profileSnapshot.data() : null);
      response.json({ success: true, action: "unban" });
    } catch (error) {
      logger.error("User moderation failed.", error);
      const status = isTokenError(error)
        ? 401
        : error.code === "auth/user-not-found" ? 404 : 500;
      const message = isTokenError(error)
        ? "The Firebase sign-in token is invalid or expired."
        : "Moderation failed. Check the account and try again.";
      sendError(response, status, message);
    }
  }
);

export const syncPublicProfiles = onRequest(
  { region: "us-central1", timeoutSeconds: 540, memory: "512MiB" },
  async (request, response) => {
    if (!applyCors(request, response)) {
      return;
    }
    if (request.method !== "POST") {
      response.set("Allow", "POST, OPTIONS");
      sendError(response, 405, "Method not allowed.");
      return;
    }

    try {
      const caller = await getCaller(request);
      if (!isAdmin(caller)) {
        sendError(response, 403, "Administrator permission required.");
        return;
      }
      let cursor = null;
      let count = 0;
      while (true) {
        let query = db.collection(USERS_COLLECTION)
          .orderBy(FieldPath.documentId())
          .limit(200);
        if (cursor) {
          query = query.startAfter(cursor);
        }
        const page = await query.get();
        if (page.empty) {
          break;
        }
        const writes = page.docs.map(async (document) => {
          await syncPublicProfile(document.id, document.data());
        });
        await Promise.all(writes);
        count += page.size;
        cursor = page.docs.at(-1);
        if (page.size < 200) {
          break;
        }
      }
      response.json({ success: true, synced: count });
    } catch (error) {
      logger.error("Could not synchronize public profiles.", error);
      sendError(
        response,
        isTokenError(error) ? 401 : 500,
        isTokenError(error)
          ? "The Firebase sign-in token is invalid or expired."
          : "Could not synchronize public profiles."
      );
    }
  }
);
