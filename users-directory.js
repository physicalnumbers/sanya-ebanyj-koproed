import { getApp, getApps, initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import { getAuth, getIdTokenResult, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import {
  collection,
  documentId,
  getDocs,
  getFirestore,
  limit,
  orderBy,
  query,
  startAfter,
  where
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
const PAGE_SIZE = 24;
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const profiles = collection(db, "communityProfiles");
const userList = document.getElementById("userList");
const usersStatus = document.getElementById("usersStatus");
const usersMore = document.getElementById("usersMore");
const adminTools = document.getElementById("adminTools");
let lastVisible = null;
let directoryRequestId = 0;
let creatorProfileId = "";

function createUserLink(snapshot) {
  const user = snapshot.data();
  const name = (typeof user.nickname === "string" && user.nickname.trim())
    || (typeof user.googleName === "string" && user.googleName.trim())
    || "Пользователь";
  const description = typeof user.description === "string" ? user.description.trim() : "";
  const avatar = typeof user.avatarUrl === "string" ? user.avatarUrl : "";
  const link = document.createElement("a");
  link.className = "user-link";
  link.href = "user.html?" + new URLSearchParams({ id: snapshot.id }).toString();

  const avatarElement = document.createElement(
    avatar.startsWith("data:image/") || avatar.startsWith("https://") ? "img" : "div"
  );
  const isImage = avatarElement.tagName === "IMG";
  avatarElement.className = isImage ? "avatar" : "avatar avatar-placeholder";
  if (isImage) {
    avatarElement.src = avatar;
    avatarElement.alt = "Аватар пользователя " + name;
  } else {
    avatarElement.setAttribute("aria-hidden", "true");
    avatarElement.textContent = Array.from(name)[0] || "?";
  }

  const copy = document.createElement("div");
  copy.className = "user-copy";
  const heading = document.createElement("div");
  heading.className = "user-heading";
  const title = document.createElement("h2");
  title.textContent = name;
  heading.appendChild(title);
  if (user.isCreator === true) {
    const badge = document.createElement("span");
    badge.className = "creator-badge";
    badge.textContent = "Создатель";
    heading.appendChild(badge);
  }
  if (user.isScam === true) {
    const badge = document.createElement("span");
    badge.className = "scam-badge";
    badge.textContent = "SCAM";
    badge.setAttribute("aria-label", "Пользователь отмечен как SCAM");
    heading.appendChild(badge);
  }
  copy.appendChild(heading);
  if (description) {
    const descriptionElement = document.createElement("p");
    descriptionElement.textContent = description;
    copy.appendChild(descriptionElement);
  }
  link.append(avatarElement, copy);
  return link;
}

async function loadUsers(append = false) {
  const requestId = ++directoryRequestId;
  usersMore.disabled = true;
  if (!append) {
    lastVisible = null;
    userList.replaceChildren();
    usersStatus.textContent = "Загружаем пользователей…";
  }

  try {
    if (!append) {
      const creatorResult = await getDocs(query(profiles, where("isCreator", "==", true), limit(1)));
      if (requestId !== directoryRequestId) {
        return;
      }
      if (!creatorResult.empty) {
        creatorProfileId = creatorResult.docs[0].id;
        userList.appendChild(createUserLink(creatorResult.docs[0]));
      }
    }

    const constraints = [orderBy(documentId())];
    if (append && lastVisible) {
      constraints.push(startAfter(lastVisible));
    }
    constraints.push(limit(PAGE_SIZE));
    const page = await getDocs(query(profiles, ...constraints));
    if (requestId !== directoryRequestId) {
      return;
    }

    page.docs.forEach(function (snapshot) {
      if (snapshot.id !== creatorProfileId) {
        userList.appendChild(createUserLink(snapshot));
      }
    });
    lastVisible = page.docs.at(-1) || lastVisible;
    usersMore.classList.toggle("hidden", page.size < PAGE_SIZE);
    usersStatus.textContent = userList.childElementCount
      ? "Пользователей: " + userList.childElementCount
      : "Пока нет пользователей с профилями.";
  } catch (error) {
    if (requestId !== directoryRequestId) {
      return;
    }
    console.error("Не удалось загрузить список пользователей:", error);
    usersStatus.textContent = error.code === "permission-denied"
      ? "Нет доступа к каталогу. Проверьте правила Firestore."
      : "Не удалось загрузить список. Проверьте подключение к Firebase.";
    usersMore.classList.add("hidden");
  } finally {
    if (requestId === directoryRequestId) {
      usersMore.disabled = false;
    }
  }
}

usersMore.addEventListener("click", function () {
  void loadUsers(true);
});

onAuthStateChanged(auth, async function (user) {
  directoryRequestId += 1;
  creatorProfileId = "";
  adminTools.classList.add("hidden");
  if (user) {
    try {
      const token = await getIdTokenResult(user);
      adminTools.classList.toggle("hidden", token.claims.admin !== true);
    } catch (error) {
      console.error("Не удалось проверить права администратора:", error);
    }
  }
  void loadUsers();
});
