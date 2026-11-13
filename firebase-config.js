// Firebase web config. These values are public by design; access is enforced
// by Firestore security rules (see firestore.rules), not by hiding this file.
export const firebaseConfig = {
  apiKey: "AIzaSyAzzRMoUNPx1AwhprSdYui9dtyPFCajF6g",
  authDomain: "cat-hero-office.firebaseapp.com",
  projectId: "cat-hero-office",
  storageBucket: "cat-hero-office.firebasestorage.app",
  messagingSenderId: "760423531513",
  appId: "1:760423531513:web:2f07d4744c9c413cdff328"
};

// Google accounts allowed into the office. The server-side copy of this list
// lives in firestore.rules; change both together.
export const ALLOWED_EMAILS = ["phamquangninh1998@gmail.com"];
