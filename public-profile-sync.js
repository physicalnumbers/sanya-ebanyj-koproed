import { getApp, getApps, initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import { getAuth, getIdTokenResult, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import {
  doc,
  getDoc,
  getFirestore,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyBqGLonGIt2m_55dt1DWjzhLGnL7m6N0J4",
  authDomain: "physical-numbers.firebaseapp.com",
  projectId: "physical-numbers",
  storageBucket: "physical-numbers.firebasestorage.app",
  messagingSenderId: "1031207446971",
  appId: "1:1031207446971:web:ed03e122d4727f8e28fc9e",
  measurementId: "G-S8J83CEQWL"
};
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const status = document.getElementById("status");
let stopProfileListener = null;
let publishedProfileFingerprint = "";
let pendingProfileSync = Promise.resolve();

function reportSyncError(error) {
  console.error("Не удалось обновить публичный профиль:", error);
  if (status) {
    status.textContent = "Профиль сохранён, но не удалось обновить публичную карточку. Проверьте правила Firestore.";
    status.className = "status error";
  }
}

async function ensurePublicProfile(user, profileSnapshot) {
  if (!profileSnapshot.exists()) {
    return;
  }

  const privateProfile = profileSnapshot.data();
  const profileId = privateProfile.publicProfileId || crypto.randomUUID();
  const publicRef = doc(db, "communityProfiles", profileId);
  const publicSnapshot = await getDoc(publicRef);
  const claims = await getIdTokenResult(user);
  const isAdmin = claims.claims.admin === true;
  const profile = {
    nickname: typeof privateProfile.nickname === "string"
      ? privateProfile.nickname.trim().slice(0, 40)
      : "",
    description: typeof privateProfile.description === "string"
      ? privateProfile.description.trim().slice(0, 500)
      : "",
    googleName: typeof privateProfile.googleName === "string"
      ? privateProfile.googleName.slice(0, 200)
      : "",
    avatarUrl: typeof privateProfile.avatarUrl === "string"
      ? privateProfile.avatarUrl
      : typeof privateProfile.avatarDataUrl === "string"
        ? privateProfile.avatarDataUrl
        : ""
  };
  const fingerprint = JSON.stringify([profileId, profile, isAdmin]);
  if (fingerprint === publishedProfileFingerprint && publicSnapshot.exists()) {
    return;
  }

  if (!publicSnapshot.exists()) {
    const batch = writeBatch(db);
    batch.set(doc(db, "users", user.uid), {
      publicProfileId: profileId,
      updatedAt: serverTimestamp()
    }, { merge: true });
    batch.set(doc(db, "privateProfileOwners", profileId), {
      uid: user.uid
    });
    batch.set(publicRef, {
      ...profile,
      isScam: false,
      isCreator: isAdmin
    });
    await batch.commit();
  } else {
    if (privateProfile.publicProfileId !== profileId) {
      await setDoc(doc(db, "users", user.uid), {
        publicProfileId: profileId,
        updatedAt: serverTimestamp()
      }, { merge: true });
    }
    await setDoc(publicRef, profile, { merge: true });
    if (isAdmin && publicSnapshot.data().isCreator !== true) {
      await updateDoc(publicRef, { isCreator: true });
    }
  }

  publishedProfileFingerprint = fingerprint;
}

onAuthStateChanged(auth, function (user) {
  if (stopProfileListener) {
    stopProfileListener();
    stopProfileListener = null;
  }
  publishedProfileFingerprint = "";
  if (!user) {
    return;
  }

  stopProfileListener = onSnapshot(
    doc(db, "users", user.uid),
    function (snapshot) {
      pendingProfileSync = pendingProfileSync
        .then(function () {
          return ensurePublicProfile(user, snapshot);
        })
        .catch(reportSyncError);
    },
    reportSyncError
  );
});
