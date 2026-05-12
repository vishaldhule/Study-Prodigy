export type ExamType = 'UPSC' | 'JEE' | 'NEET' | 'BCA' | 'Engineering' | 'General' | 'Law' | 'Medical';

export interface StudySession {
  id: string;
  title: string;
  timestamp: number;
  examType: ExamType;
  rawContent?: string;
  refinedNotes?: string;
  summary?: {
    feynman: string;
    deepDive: string;
  };
  quiz?: QuizQuestion[];
  visualMap?: string;
}

export interface QuizQuestion {
  id: string;
  question: string;
  options: string[];
  correctAnswer: number;
  hint: string;
  explanation: string;
}

export interface ProcessingState {
  isProcessing: boolean;
  step: 'ocr' | 'refining' | 'summarizing' | 'quizzing' | 'mapping' | 'idle';
  error?: string;
}

export interface StudyReminder {
  id: string;
  topic: string;
  time: string; // ISO string
  isCompleted: boolean;
  userId?: string;
}

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  photoURL: string;
  dailyStreak: number;
  points: number;
  lastActive: string;
  examType: ExamType;
}
