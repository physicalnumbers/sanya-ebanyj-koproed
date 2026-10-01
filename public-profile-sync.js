import { getApp, getApps, initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import { getAuth, getIdTokenResult, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import {
  doc,
  getDoc,
  getFirestore,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc
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
    const code = typeof error.code === "string" ? " (" + error.code + ")" : "";
    status.textContent = "Профиль сохранён, но публичная карточка не обновилась" + code + ". Повторите попытку позже.";
    status.className = "status error";
  }
}

async function ensurePublicProfile(user, profileSnapshot) {
  if (!profileSnapshot.exists()) {
    return;
  }

  const latestProfile = await getDoc(doc(db, "users", user.uid));
  if (!latestProfile.exists()) {
    return;
  }
  const privateProfile = latestProfile.data();
  const profileId = privateProfile.publicProfileId || crypto.randomUUID();
  const privateProfileRef = doc(db, "users", user.uid);
  if (privateProfile.publicProfileId !== profileId) {
    await setDoc(privateProfileRef, {
      publicProfileId: profileId,
      updatedAt: serverTimestamp()
    }, { merge: true });
  }

  const ownerRef = doc(db, "privateProfileOwners", profileId);
  await setDoc(ownerRef, { uid: user.uid });

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
    await setDoc(publicRef, {
      ...profile,
      isScam: false,
      isCreator: isAdmin
    });
  } else {
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
