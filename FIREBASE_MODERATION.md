# Firebase moderation setup

The public directory and moderation tools use Firebase Cloud Functions. A hidden
button in the static site is not an authorization boundary: the functions verify
Firebase ID tokens and require the `admin` custom claim for account IDs,
moderation, and directory synchronization.

## One-time deployment

1. Use Node.js 22 or later, install the Firebase CLI, and sign in with an account
   that can deploy to the `physical-numbers` Firebase project.
2. Make sure the project can deploy Cloud Functions (the Firebase project may
   need the Blaze billing plan) and that Cloud Functions and Cloud Build APIs are
   enabled.
3. Authenticate the Firebase Admin SDK with Google Application Default
   Credentials (`gcloud auth application-default login`), or set
   `GOOGLE_APPLICATION_CREDENTIALS` to a service-account key stored outside
   this repository. Never commit a service-account key.
4. Install the function dependencies and deploy the server functions and
   Firestore rules:

   ```powershell
   npm --prefix functions install
   firebase deploy --only firestore:rules,functions --project physical-numbers
   ```

5. In Firebase Console, open **Authentication → Users**, copy the creator's
   Firebase **UID**, then grant the admin claim:

   ```powershell
   npm --prefix functions run set-admin -- YOUR_FIREBASE_UID
   ```

   This command uses Application Default Credentials and preserves any other
   custom claims already assigned to the account. It does not accept an email
   address as the administrator identity.
6. Sign out of the site and sign back in so Firebase issues an ID token with the
   new claim. Open the user directory and use **Synchronize public profiles**
   once to create public, privacy-filtered directory records for existing
   accounts.

## Access model

- Users can read and change only their own profile document. Firestore rules
  prevent clients from listing other private user documents or writing
  moderation state.
- Cloud Functions maintain a separate directory projection. Firestore rules
  deny clients direct access to it; public responses include only nickname,
  description, avatar, and an opaque profile ID. Actual Firebase UIDs are
  returned only to authenticated administrators.
- Only accounts with the server-verified `admin: true` custom claim can see
  moderation controls, inspect Firebase UIDs, or ban/unban accounts.
- Blocking disables the Firebase Authentication account, revokes refresh
  tokens, denies its Firestore profile access, and removes it from the public
  directory. Unblocking restores the account's previous disabled state.
- The creator's own profile is pinned above the directory for every visitor.
