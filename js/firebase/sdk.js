// Re-exporta las funciones del SDK modular para no repetir URLs de CDN.
export {
  onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  signOut, sendPasswordResetEmail, updateProfile
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

export {
  doc, collection, getDoc, getDocs, setDoc, updateDoc, deleteDoc, addDoc,
  query, where, orderBy, limit, onSnapshot, runTransaction,
  serverTimestamp, Timestamp, writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
