# Free user directory and SCAM labels

The user directory runs on GitHub Pages and Cloud Firestore. It does not call
Cloud Functions, so deploying this version does not require the Blaze plan.

## One-time setup

1. In Firebase Console, make sure Firestore Database and Google sign-in in
   Firebase Authentication are enabled for the `physical-numbers` project.
2. Install Node.js and Firebase CLI, then sign in and deploy only Firestore
   rules:

   ```powershell
   firebase login
   firebase deploy --only firestore:rules --project physical-numbers
   ```

   These rules and the directory use the free Spark plan within Firebase's
   applicable quotas. Do not deploy Cloud Functions for this directory.
3. To enable owner-only SCAM labels, copy the creator's Firebase UID from
   **Firebase Console → Authentication → Users**. On a trusted computer, set
   up Google Application Default Credentials:

   ```powershell
   gcloud auth application-default login
   npm --prefix functions install
   npm --prefix functions run set-admin -- YOUR_FIREBASE_UID
   ```

   The script preserves other custom claims, grants `admin: true`, and records
   the owner. It uses the Firebase Admin SDK locally; it does not deploy a
   Cloud Function. Never share or commit service-account keys.
4. Sign out of the site and sign in again so Firebase refreshes the ID token.
   Visit the personal profile page while signed in. Existing profiles are
   copied into the public directory automatically; new profiles appear after
   they are saved.

## What the label does

- Visitors can read only the public nickname, description, avatar, creator
  indicator, and SCAM indicator in `communityProfiles`. Email, wallet addresses,
  and Firebase UIDs are not included in those documents. A separate
  `privateProfileOwners` mapping binds each random profile ID to its owner and
  cannot be read or changed by clients.
- Users can create/update only their own public profile. Firestore Rules reserve
  the SCAM flag for accounts carrying the administrator custom claim.
- The creator opens a user's profile and selects **Отметить как SCAM** or
  **Снять метку SCAM**. The label appears next to the nickname in the directory
  and on the profile page.
- This is a public warning label, not an account ban or an independently
  verified finding. Use it only after checking reliable evidence.
- The old `publicUsers` collection remains inaccessible to clients. The new
  directory uses random profile IDs and never publishes Firebase UIDs.

Firebase Spark quotas still apply. The site does not disable or delete a user's
Firebase Authentication account.
