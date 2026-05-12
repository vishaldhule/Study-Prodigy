import { initializeApp, FirebaseApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged, User as FirebaseUser } from 'firebase/auth';
import { getFirestore, doc, getDoc, setDoc, deleteDoc, collection, query, where, getDocs, onSnapshot, orderBy, limit, Timestamp, getDocFromServer } from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';
import { StudySession, StudyReminder, ExamType } from '../types';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth();
const googleProvider = new GoogleAuthProvider();

// --- Connection Test ---
async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if(error instanceof Error && error.message.includes('the client is offline')) {
      console.error("Please check your Firebase configuration. The client appears to be offline.");
    }
  }
}
testConnection();

// --- Error Handling ---
export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
    },
    operationType,
    path
  };
  const errorJson = JSON.stringify(errInfo);
  console.error('Firestore Error: ', errorJson);
  throw new Error(errorJson);
}

// --- Auth Helpers ---

export const signInWithGoogle = async () => {
  try {
    const result = await signInWithPopup(auth, googleProvider);
    await ensureUserDoc(result.user);
    return result.user;
  } catch (error) {
    console.error("Login failed", error);
    throw error;
  }
};

export const logout = () => signOut(auth);

const ensureUserDoc = async (user: FirebaseUser) => {
  const userRef = doc(db, 'users', user.uid);
  const userSnap = await getDoc(userRef);
  
  if (!userSnap.exists()) {
    await setDoc(userRef, {
      uid: user.uid,
      email: user.email,
      displayName: user.displayName,
      photoURL: user.photoURL,
      dailyStreak: 0,
      points: 0,
      lastActive: new Date().toISOString(),
      examType: 'General'
    });
  } else {
    // Update last active
    await setDoc(userRef, { lastActive: new Date().toISOString() }, { merge: true });
  }
};

// --- Firestore Helpers ---

export async function saveSession(userId: string, session: StudySession) {
  const sessionRef = doc(db, 'users', userId, 'sessions', session.id);
  try {
    await setDoc(sessionRef, session);
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `users/${userId}/sessions/${session.id}`);
  }
}

export async function saveReminder(userId: string, reminder: StudyReminder) {
  const reminderRef = doc(db, 'users', userId, 'reminders', reminder.id);
  try {
    await setDoc(reminderRef, { ...reminder, userId });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `users/${userId}/reminders/${reminder.id}`);
  }
}

export async function deleteReminderFromDb(userId: string, reminderId: string) {
  const reminderRef = doc(db, 'users', userId, 'reminders', reminderId);
  try {
    await deleteDoc(reminderRef);
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `users/${userId}/reminders/${reminderId}`);
  }
}

export function subscribeToSessions(userId: string, callback: (sessions: StudySession[]) => void) {
  const q = query(
    collection(db, 'users', userId, 'sessions'),
    orderBy('timestamp', 'desc'),
    limit(20)
  );
  return onSnapshot(q, (snapshot) => {
    const sessions = snapshot.docs.map(doc => doc.data() as StudySession);
    callback(sessions);
  }, (error) => {
    handleFirestoreError(error, OperationType.GET, `users/${userId}/sessions`);
  });
}

export function subscribeToReminders(userId: string, callback: (reminders: StudyReminder[]) => void) {
  const q = query(collection(db, 'users', userId, 'reminders'));
  return onSnapshot(q, (snapshot) => {
    const reminders = snapshot.docs.map(doc => doc.data() as StudyReminder);
    callback(reminders);
  }, (error) => {
    handleFirestoreError(error, OperationType.GET, `users/${userId}/reminders`);
  });
}

export async function updateUserPoints(userId: string, pointsToAdd: number) {
  const userRef = doc(db, 'users', userId);
  try {
    const userSnap = await getDoc(userRef);
    if (userSnap.exists()) {
      const currentPoints = userSnap.data().points || 0;
      await setDoc(userRef, { points: currentPoints + pointsToAdd }, { merge: true });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `users/${userId}`);
  }
}

export async function updateUserStreak(userId: string, streak: number) {
  const userRef = doc(db, 'users', userId);
  try {
    await setDoc(userRef, { dailyStreak: streak }, { merge: true });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `users/${userId}`);
  }
}

export function subscribeToUserProfile(userId: string, callback: (user: any) => void) {
  return onSnapshot(doc(db, 'users', userId), (doc) => {
    callback(doc.data());
  }, (error) => {
    handleFirestoreError(error, OperationType.GET, `users/${userId}`);
  });
}
