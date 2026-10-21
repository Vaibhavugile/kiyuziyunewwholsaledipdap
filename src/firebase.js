import { initializeApp } from 'firebase/app';
import { 
  getFirestore, 
  collection, 
  getDocs, 
  addDoc, 
  setDoc, 
  doc, 
  updateDoc, 
  deleteDoc, 
  getDoc,
  query,
  where,
  writeBatch, // Added for batch operations
  runTransaction, // Added for transactions
  orderBy, // This is the new import you need
   serverTimestamp,
   startAfter,
   limit,
   collectionGroup ,
} from 'firebase/firestore';
import { 
  getAuth, 
  signInWithPhoneNumber, 
  onAuthStateChanged, 
  RecaptchaVerifier,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  signInAnonymously,
} from 'firebase/auth';
import { getStorage, ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';

const firebaseConfig = {
  apiKey: "AIzaSyDQAeBwm1_ODLhTwyzZjJfwAVGt5_An2ME",
  authDomain: "tanishkaretail-4a7e1.firebaseapp.com",
  projectId: "tanishkaretail-4a7e1",
  storageBucket: "tanishkaretail-4a7e1.firebasestorage.app",
  messagingSenderId: "566682935029",
  appId: "1:566682935029:web:a7c38789bd70c229602fbc",
  measurementId: "G-DWST8SEP4W"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
const storage = getStorage(app);

// Export all necessary services and functions
export {
  db,
  collection,
  getDocs,
  addDoc,
  getDoc,
  setDoc,
  doc,
  updateDoc,
  deleteDoc,
  auth,
  signInWithPhoneNumber,
  onAuthStateChanged,
  RecaptchaVerifier,
  storage,
  ref,
  uploadBytes,
  getDownloadURL,
  deleteObject,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  query,
  where,
  writeBatch,
  runTransaction,
  orderBy,
   serverTimestamp,
   signOut,  // Exporting the newly added function
   signInAnonymously,
   limit,
   startAfter,
   collectionGroup,
   getStorage,
};