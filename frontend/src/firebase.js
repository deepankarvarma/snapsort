// // Import the functions you need from the SDKs you need
// import { initializeApp } from "firebase/app";
// import { getAnalytics } from "firebase/analytics";
// // TODO: Add SDKs for Firebase products that you want to use
// // https://firebase.google.com/docs/web/setup#available-libraries

// // Your web app's Firebase configuration
// // For Firebase JS SDK v7.20.0 and later, measurementId is optional
// const firebaseConfig = {
//   apiKey: "AIzaSyDAmwMTgL1_XTCY63whE2HCrzKF4Le75n0",
//   authDomain: "snap-sort-e8299.firebaseapp.com",
//   databaseURL: "https://snap-sort-e8299-default-rtdb.firebaseio.com",
//   projectId: "snap-sort-e8299",
//   storageBucket: "snap-sort-e8299.firebasestorage.app",
//   messagingSenderId: "594756119752",
//   appId: "1:594756119752:web:2c4b76dd23ef9369dc89fd",
//   measurementId: "G-M2H8VPKKLZ"
// };

// // Initialize Firebase
// const app = initializeApp(firebaseConfig);
// const analytics = getAnalytics(app);

// ═══════════════════════════════════════════════════════
// Firebase Configuration
// ═══════════════════════════════════════════════════════
// SETUP INSTRUCTIONS:
// 1. Go to https://console.firebase.google.com
// 2. Create a project (free tier works)
// 3. Go to Build → Realtime Database → Create Database (test mode)
// 4. Go to Project Settings → Your apps → Add web app (</> icon)
// 5. Replace the values below with YOUR config
// ═══════════════════════════════════════════════════════

const firebaseConfig = {
  apiKey: "AIzaSyDAmwMTgL1_XTCY63whE2HCrzKF4Le75n0",
  authDomain: "snap-sort-e8299.firebaseapp.com",
  databaseURL: "https://snap-sort-e8299-default-rtdb.firebaseio.com",
  projectId: "snap-sort-e8299",
  storageBucket: "snap-sort-e8299.firebasestorage.app",
  messagingSenderId: "594756119752",
  appId: "1:594756119752:web:2c4b76dd23ef9369dc89fd",
  measurementId: "G-M2H8VPKKLZ"
};

// Returns true if Firebase is configured
export const isFirebaseConfigured = () => {
  return firebaseConfig.apiKey !== "" && firebaseConfig.projectId !== "";
};

export default firebaseConfig;
