import { getApp, getApps, initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import { getAuth, getIdTokenResult, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import { doc, getDoc, getFirestore, updateDoc } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

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
const profileElement = document.getElementById("profile");
const profileStatus = document.getElementById("profileStatus");
const publicNotice = document.getElementById("publicNotice");
const adminPanel = document.getElementById("adminPanel");
const scamButton = document.getElementById("scamButton");
const moderationStatus = document.getElementById("moderationStatus");
const creatorBadge = document.getElementById("creatorBadge");
const scamBadge = document.getElementById("scamBadge");
const avatar = document.getElementById("avatar");
const nicknameElement = document.getElementById("nickname");
const descriptionElement = document.getElementById("description");
let currentUser = null;
let currentProfileId = "";
let currentIsAdmin = false;
let currentIsScam = false;
let currentIsCreator = false;

function showProfile(user) {
  const nickname = typeof user.nickname === "string" && user.nickname.trim()
    ? user.nickname.trim()
    : typeof user.googleName === "string" && user.googleName.trim()
      ? user.googleName.trim()
      : "Пользователь";
  const description = typeof user.description === "string" ? user.description.trim() : "";
  const avatarValue = typeof user.avatarUrl === "string" ? user.avatarUrl : "";
  nicknameElement.textContent = nickname;
  document.title = nickname + " — Физические Номера";
  descriptionElement.textContent = description || "Пользователь пока ничего не рассказал о себе.";
  descriptionElement.classList.toggle("empty-description", !description);
  if (avatarValue.startsWith("data:image/") || avatarValue.startsWith("https://")) {
    const image = document.createElement("img");
    image.alt = "Аватар пользователя " + nickname;
    image.src = avatarValue;
    avatar.classList.remove("avatar-placeholder");
    avatar.setAttribute("aria-hidden", "false");
    avatar.replaceChildren(image);
  } else {
    avatar.classList.add("avatar-placeholder");
    avatar.setAttribute("aria-hidden", "true");
    avatar.replaceChildren();
    avatar.textContent = Array.from(nickname)[0] || "?";
  }
  currentIsScam = user.isScam === true;
  currentIsCreator = user.isCreator === true;
  creatorBadge.classList.toggle("hidden", !currentIsCreator);
  scamBadge.classList.toggle("hidden", !currentIsScam);
  profileElement.classList.remove("hidden");
  profileStatus.classList.add("hidden");
  publicNotice.classList.remove("hidden");
  adminPanel.classList.toggle("hidden", !currentIsAdmin || currentIsCreator);
  updateScamButton();
}

function updateScamButton() {
  scamButton.textContent = currentIsScam ? "Снять метку SCAM" : "Отметить как SCAM";
}

async function loadProfile() {
  currentProfileId = new URLSearchParams(window.location.search).get("id") || "";
  if (!/^[A-Za-z0-9_-]{36}$/.test(currentProfileId)) {
    profileStatus.textContent = "Не удалось определить профиль. Откройте его из списка пользователей.";
    return;
  }

  try {
    const snapshot = await getDoc(doc(db, "communityProfiles", currentProfileId));
    if (!snapshot.exists()) {
      profileStatus.textContent = "Профиль не найден. Возможно, пользователь ещё не опубликовал профиль.";
      return;
    }
    showProfile(snapshot.data());
  } catch (error) {
    console.error("Не удалось загрузить профиль:", error);
    profileStatus.textContent = error.code === "permission-denied"
      ? "Нет доступа к профилю. Проверьте правила Firestore."
      : "Не удалось загрузить профиль. Попробуйте обновить страницу.";
  }
}

scamButton.addEventListener("click", async function () {
  if (!currentUser || !currentIsAdmin || currentIsCreator) {
    return;
  }
  const action = currentIsScam ? "снять отметку SCAM" : "поставить публичную отметку SCAM";
  if (!window.confirm("Вы уверены, что хотите " + action + " для этого профиля?")) {
    return;
  }

  scamButton.disabled = true;
  moderationStatus.textContent = "Сохраняем отметку…";
  try {
    await updateDoc(doc(db, "communityProfiles", currentProfileId), {
      isScam: !currentIsScam
    });
    currentIsScam = !currentIsScam;
    scamBadge.classList.toggle("hidden", !currentIsScam);
    updateScamButton();
    moderationStatus.textContent = currentIsScam
      ? "Публичная отметка SCAM установлена."
      : "Отметка SCAM снята.";
  } catch (error) {
    console.error("Не удалось изменить отметку SCAM:", error);
    moderationStatus.textContent = error.code === "permission-denied"
      ? "Firebase не разрешил действие. Проверьте admin claim и правила Firestore."
      : "Не удалось сохранить отметку. Попробуйте ещё раз.";
  } finally {
    scamButton.disabled = false;
  }
});

onAuthStateChanged(auth, async function (user) {
  currentUser = user;
  currentIsAdmin = false;
  adminPanel.classList.add("hidden");
  if (user) {
    try {
      const token = await getIdTokenResult(user);
      currentIsAdmin = token.claims.admin === true;
    } catch (error) {
      console.error("Не удалось проверить права администратора:", error);
    }
  }
  await loadProfile();
});
