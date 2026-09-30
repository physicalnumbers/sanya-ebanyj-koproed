import { applicationDefault, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

const [uid] = process.argv.slice(2);

if (!uid || uid.length > 128 || uid.includes("/")) {
  console.error("Usage: npm run set-admin -- <firebase-auth-uid>");
  process.exitCode = 1;
} else {
  initializeApp({
    credential: applicationDefault(),
    projectId: process.env.GCLOUD_PROJECT || "physical-numbers"
  });

  try {
    const auth = getAuth();
    const user = await auth.getUser(uid);
    const db = getFirestore();
    const ownerRef = db.collection("siteSettings").doc("owner");
    const ownerSnapshot = await ownerRef.get();
    if (ownerSnapshot.exists && ownerSnapshot.get("uid") !== uid) {
      throw new Error("A different site owner is already configured.");
    }
    await ownerRef.set({
      uid,
      updatedAt: FieldValue.serverTimestamp()
    });
    await auth.setCustomUserClaims(uid, {
      ...user.customClaims,
      admin: true
    });
    console.log(`Admin access granted to Firebase user ${uid}.`);
    console.log("Sign out and sign back in to refresh the user's ID token.");
  } catch (error) {
    console.error("Could not grant admin access:", error.message);
    process.exitCode = 1;
  }
}
