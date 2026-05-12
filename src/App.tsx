import React, { useState, useEffect } from 'react';
import { BookOpen, Upload, ClipboardList, Lightbulb, Map as MapIcon, GraduationCap, ChevronRight, Loader2, Sparkles, Bell, Clock, Trash2, X, Plus, Download, FileText, Scale, Landmark, Cog, Calculator, Activity, Code } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import { useDropzone } from 'react-dropzone';

import { cn, fileToBase64 } from './lib/utils';
import { ExamType, StudySession, QuizQuestion, ProcessingState, StudyReminder } from './types';
import { processStudyMaterial, generateQuiz } from './services/gemini';

import { auth, signInWithGoogle, logout, saveSession, saveReminder, deleteReminderFromDb, subscribeToSessions, subscribeToReminders, subscribeToUserProfile, updateUserPoints } from './services/firebase';
import { User } from 'firebase/auth';
import { askAITutor } from './services/gemini';

// --- Shared Components ---

const Button = ({ className, variant = 'primary', ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'outline' }) => (
  <button
    {...props}
    className={cn(
      "px-4 py-2 rounded-lg font-medium transition-all active:scale-95 disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer",
      variant === 'primary' && "bg-indigo-600 text-white hover:bg-indigo-700 shadow-md",
      variant === 'secondary' && "bg-white text-indigo-900 hover:bg-indigo-50 border border-indigo-100",
      variant === 'outline' && "bg-transparent border-2 border-indigo-200 text-indigo-600 hover:bg-indigo-50",
      className
    )}
  />
);

const UserAvatar = ({ user, onClick }: { user: User | null; onClick: () => void }) => (
  <button onClick={onClick} className="flex items-center gap-2 p-1 pl-3 bg-white border border-indigo-100 rounded-full hover:bg-indigo-50 transition-colors">
    <div className="text-right hidden sm:block">
      <p className="text-[10px] font-black uppercase text-indigo-400">Student</p>
      <p className="text-xs font-bold text-indigo-900">{user?.displayName?.split(' ')[0] || 'Account'}</p>
    </div>
    <div className="w-8 h-8 rounded-full overflow-hidden bg-indigo-100">
      {user?.photoURL ? (
        <img src={user.photoURL} alt={user.displayName || ''} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
      ) : (
        <div className="w-full h-full flex items-center justify-center text-indigo-400">
          <GraduationCap size={16} />
        </div>
      )}
    </div>
  </button>
);

const Card = ({ children, className, id }: { children: React.ReactNode; className?: string; id?: string }) => (
  <div id={id} className={cn("bg-white rounded-2xl border border-indigo-50 shadow-sm p-6 overflow-hidden", className)}>
    {children}
  </div>
);

const Markdown = ({ content }: { content: string }) => (
  <div className="prose prose-indigo max-w-none overflow-x-auto custom-scrollbar">
    <ReactMarkdown 
      remarkPlugins={[remarkMath]} 
      rehypePlugins={[rehypeKatex]}
    >
      {content}
    </ReactMarkdown>
  </div>
);

const DailyPuzzle = ({ examType, user }: { examType: ExamType, user: User | null }) => {
  const [status, setStatus] = useState<'idle' | 'solving' | 'done'>('idle');
  const [answer, setAnswer] = useState('');
  
  const puzzle = {
    UPSC: { q: "Which constitutional amendment is known as the 'Mini-Constitution'?", a: "42nd" },
    JEE: { q: "What is the derivative of x^x?", a: "x^x(1+ln x)" },
    NEET: { q: "Which part of the brain controls body temperature?", a: "Hypothalamus" },
    BCA: { q: "What is the time complexity of building a heap of n elements?", a: "O(n)" },
    Engineering: { q: "What is the unit of Specific Speed for a turbine?", a: "dimensionless" },
    General: { q: "Who developed the Feynman Technique?", a: "Richard Feynman" }
  }[examType] || { q: "What is 2+2?", a: "4" };

  const handleCheck = async () => {
    if (answer.toLowerCase().includes(puzzle.a.toLowerCase().split(' ')[0])) {
      setStatus('done');
      if (user) {
        await updateUserPoints(user.uid, 10);
      }
    }
  };

  return (
    <Card className="bg-gradient-to-br from-indigo-600 to-violet-700 text-white border-none shadow-xl shadow-indigo-200">
      <div className="flex items-center gap-2 mb-4">
        <div className="p-2 bg-white/20 rounded-lg text-white">
          <BookOpen size={18} />
        </div>
        <span className="text-xs font-black uppercase tracking-widest text-indigo-100">Daily Brain Teaser</span>
      </div>
      
      <div className="space-y-4">
        <p className="text-lg font-bold leading-tight">{puzzle.q}</p>
        
        {status === 'done' ? (
          <div className="p-3 bg-emerald-500/20 border border-emerald-500/30 rounded-xl flex items-center gap-3">
            <div className="w-6 h-6 bg-emerald-500 rounded-full flex items-center justify-center text-[10px]">✓</div>
            <p className="text-sm font-medium">Correct! +10 Points Added.</p>
          </div>
        ) : (
          <div className="flex gap-2">
            <input 
              type="text" 
              placeholder="Your answer..."
              className="flex-1 bg-white/10 border border-white/20 rounded-xl p-2.5 text-sm placeholder:text-white/40 focus:bg-white/20 outline-none transition-all"
              value={answer}
              onChange={e => setAnswer(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleCheck()}
            />
            <Button 
              onClick={handleCheck}
              className="h-10 px-4 bg-white text-indigo-600 hover:bg-indigo-50 border-none"
            >
              Check
            </Button>
          </div>
        )}
      </div>
      
      <div className="mt-4 flex items-center justify-between text-[10px] font-black uppercase tracking-widest text-indigo-300">
        <span>Level: Hard</span>
        <span>Topic: {examType} Core</span>
      </div>
    </Card>
  );
};

const AITutorChat = ({ examType, secondaryDetails, user }: { examType: ExamType, secondaryDetails: string, user: User | null }) => {
  const [query, setQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<{ explanation: string; quiz: QuizQuestion[] } | null>(null);
  const [quizProgress, setQuizProgress] = useState<{ [qId: string]: { showHint: boolean; selected: number | null; isCorrect: boolean | null } }>({});

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    
    setIsLoading(true);
    setResult(null);
    setQuizProgress({});
    try {
      const data = await askAITutor(query, examType, secondaryDetails);
      setResult(data);
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleQuizAnswer = (qId: string, index: number, correctIndex: number) => {
    setQuizProgress(prev => ({
      ...prev,
      [qId]: { ...prev[qId], selected: index, isCorrect: index === correctIndex }
    }));
    if (index === correctIndex && user) {
        updateUserPoints(user.uid, 5);
    }
  };

  const answeredCount = Object.keys(quizProgress).length;
  const totalQuestions = result?.quiz?.length || 0;
  const isFinished = result && totalQuestions > 0 && answeredCount === totalQuestions;
  const score = Object.values(quizProgress).filter(p => p.isCorrect).length;

  return (
    <div className="w-full max-w-4xl mx-auto mb-12">
      <div className="relative group">
        <form onSubmit={handleSearch} className="relative z-10 flex items-center gap-3 p-2 bg-white rounded-3xl shadow-xl shadow-indigo-100 border border-indigo-50 transition-all focus-within:ring-2 focus-within:ring-indigo-600 focus-within:border-transparent">
          <div className="pl-4 text-indigo-400">
            <Sparkles size={24} className={isLoading ? "animate-pulse text-indigo-600" : ""} />
          </div>
          <input 
            type="text" 
            placeholder={`Ask me anything about ${examType}... e.g. "Explain Quantum Entanglement"`}
            className="flex-1 h-14 bg-transparent outline-none text-indigo-900 font-medium placeholder:text-indigo-300 text-sm sm:text-base min-w-0"
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
          <Button type="submit" disabled={isLoading} className="h-14 px-6 sm:px-10 rounded-2xl shadow-none whitespace-nowrap">
            {isLoading ? <Loader2 className="animate-spin" size={20} /> : <span className="hidden xs:inline">Teach Me</span>}
            {!isLoading && <Sparkles size={18} className="xs:hidden" />}
          </Button>
        </form>
        <div className="absolute inset-0 bg-indigo-600 rounded-3xl blur-2xl opacity-[0.03] group-hover:opacity-[0.08] transition-opacity" />
      </div>

      <AnimatePresence>
        {result && (
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="mt-8 space-y-6"
          >
            {isFinished && (
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                className="p-8 bg-indigo-950 text-white rounded-[2rem] shadow-2xl flex flex-col md:flex-row items-center justify-between gap-6 overflow-hidden relative"
              >
                <div className="absolute top-0 right-0 p-8 opacity-10 rotate-12">
                  <Sparkles size={120} />
                </div>
                <div className="relative z-10 text-center md:text-left">
                  <div className="flex items-center justify-center md:justify-start gap-2 mb-2">
                    <Sparkles size={16} className="text-indigo-400" />
                    <span className="text-[10px] font-black uppercase tracking-widest text-indigo-400">Tutor Session Complete</span>
                  </div>
                  <h2 className="text-3xl font-black mb-1">Academic Result</h2>
                  <p className="text-indigo-300 font-medium italic">"The beautiful thing about learning is that no one can take it away from you."</p>
                </div>
                
                <div className="relative z-10 flex flex-wrap items-center justify-center gap-4 bg-white/10 p-4 sm:p-6 rounded-[2.5rem] backdrop-blur-sm border border-white/5">
                   <div className="text-center min-w-[80px]">
                      <p className="text-[10px] font-black uppercase text-indigo-200 mb-1">Score</p>
                      <p className="text-3xl sm:text-4xl font-black">{score}/{totalQuestions}</p>
                   </div>
                   <div className="hidden xs:block w-px h-8 sm:h-12 bg-white/20" />
                   <div className="text-center min-w-[80px]">
                      <p className="text-[10px] font-black uppercase text-indigo-200 mb-1">Efficiency</p>
                      <p className="text-3xl sm:text-4xl font-black">{Math.round((score/totalQuestions) * 100)}%</p>
                   </div>
                </div>
              </motion.div>
            )}

            <Card className="border-l-4 border-l-indigo-600 shadow-lg">
              <div className="flex items-center gap-3 mb-6">
                <div className="p-2.5 bg-indigo-50 rounded-xl text-indigo-600">
                  <Lightbulb size={22} />
                </div>
                <div>
                  <h3 className="text-xl font-bold text-indigo-950 uppercase tracking-tight">Academic Tutor</h3>
                  <p className="text-[10px] font-black text-indigo-400 uppercase tracking-widest">Feynman Method</p>
                </div>
              </div>
              <Markdown content={result.explanation} />
            </Card>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {result.quiz.map((q, idx) => (
                <Card key={q.id} className="relative group overflow-visible border-indigo-50">
                  <div className="absolute -top-3 -left-3 w-10 h-10 bg-indigo-900 text-white rounded-xl flex items-center justify-center font-black text-sm shadow-xl border-2 border-white">
                    Q{idx + 1}
                  </div>
                  <p className="font-bold text-indigo-950 mb-6 pt-4 leading-snug text-lg">{q.question}</p>
                  <div className="space-y-3">
                    {q.options.map((opt, oIdx) => {
                      const state = quizProgress[q.id];
                      const isSelected = state?.selected === oIdx;
                      const isCorrect = oIdx === q.correctAnswer;
                      return (
                        <button
                          key={oIdx}
                          disabled={state?.selected !== null}
                          onClick={() => handleQuizAnswer(q.id, oIdx, q.correctAnswer)}
                          className={cn(
                            "w-full p-4 rounded-2xl text-left text-sm font-medium border transition-all flex items-center gap-3",
                            isSelected 
                              ? state.isCorrect ? "bg-emerald-50 border-emerald-200 text-emerald-900" : "bg-rose-50 border-rose-200 text-rose-900"
                              : state?.selected !== null && isCorrect
                                ? "bg-emerald-50 border-emerald-200 text-emerald-900 opacity-60"
                                : "bg-indigo-50/30 border-indigo-100 hover:border-indigo-400 hover:bg-white"
                          )}
                        >
                          <div className={cn(
                             "w-6 h-6 rounded-lg flex items-center justify-center text-[10px] font-black",
                             isSelected ? "bg-white text-indigo-600 shadow-sm" : "bg-indigo-100/50 text-indigo-400"
                          )}>
                            {String.fromCharCode(65 + oIdx)}
                          </div>
                          {opt}
                        </button>
                      );
                    })}
                  </div>
                  {quizProgress[q.id]?.selected !== null && (
                    <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="mt-6 p-4 bg-indigo-950 text-indigo-50 rounded-2xl text-xs font-medium leading-relaxed shadow-inner">
                      <div className="flex items-center gap-2 mb-2 text-indigo-400">
                        <Sparkles size={14} />
                        <span className="uppercase font-black tracking-widest text-[10px]">Logic Deep Dive</span>
                      </div>
                      {q.explanation}
                    </motion.div>
                  )}
                </Card>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

const TRACKS: { id: ExamType; label: string; icon: any; color: string }[] = [
  { id: 'General', label: 'Basic Student', icon: GraduationCap, color: 'bg-indigo-500' },
  { id: 'Medical', label: 'Medical (MBBS/PG)', icon: Activity, color: 'bg-rose-500' },
  { id: 'Law', label: 'Law (LLB/Clat)', icon: Scale, color: 'bg-slate-700' },
  { id: 'UPSC', label: 'Civil Services', icon: Landmark, color: 'bg-amber-600' },
  { id: 'Engineering', label: 'Engineering', icon: Cog, color: 'bg-blue-600' },
  { id: 'JEE', label: 'JEE (IIT)', icon: Calculator, color: 'bg-cyan-600' },
  { id: 'NEET', label: 'NEET (UG)', icon: Activity, color: 'bg-emerald-600' },
  { id: 'BCA', label: 'Computer Apps', icon: Code, color: 'bg-violet-600' },
];

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<any>(null);
  const [examType, setExamType] = useState<ExamType>('General');
  const [secondaryDetails, setSecondaryDetails] = useState('');
  const [sessions, setSessions] = useState<StudySession[]>([]);
  const [reminders, setReminders] = useState<StudyReminder[]>([]);
  const [currentSession, setCurrentSession] = useState<StudySession | null>(null);
  const [processing, setProcessing] = useState<ProcessingState>({ isProcessing: false, step: 'idle' });
  const [quizProgress, setQuizProgress] = useState<{ [qId: string]: { showHint: boolean; selected: number | null; isCorrect: boolean | null } }>({});
  const [showRemindersModal, setShowRemindersModal] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [showTrackModal, setShowTrackModal] = useState(false);
  const [newReminder, setNewReminder] = useState({ topic: '', time: '', date: '' });
  const [isInitializing, setIsInitializing] = useState(true);

  // Auth Listener
  useEffect(() => {
    return auth.onAuthStateChanged((u) => {
      setUser(u);
      setIsInitializing(false);
      if (!u) {
        setProfile(null);
        setSessions([]);
        setReminders([]);
      }
    });
  }, []);

  // Show Track Selection if not set
  useEffect(() => {
    if (user && profile && !profile.examType) {
      setShowTrackModal(true);
    }
  }, [user, profile]);

  // Sync Exam Type with Profile
  useEffect(() => {
    if (profile?.examType) {
      setExamType(profile.examType);
    }
    if (profile?.secondaryDetails) {
      setSecondaryDetails(profile.secondaryDetails);
    }
  }, [profile]);

  // Firebase Sync
  useEffect(() => {
    if (!user) return;

    const unsubSessions = subscribeToSessions(user.uid, setSessions);
    const unsubReminders = subscribeToReminders(user.uid, setReminders);
    const unsubProfile = subscribeToUserProfile(user.uid, setProfile);

    return () => {
      unsubSessions();
      unsubReminders();
      unsubProfile();
    };
  }, [user]);

  // Export Feature
  const exportToMarkdown = (session: StudySession) => {
    let md = `# ${session.title}\n\n`;
    md += `**Exam Type:** ${session.examType}\n`;
    md += `**Date:** ${new Date(session.timestamp).toLocaleDateString()}\n\n`;
    
    md += `## Refined Notes\n\n${session.refinedNotes}\n\n`;
    
    if (session.summary) {
      md += `## Feynman Summary\n\n${session.summary.feynman}\n\n`;
      md += `## Deep Dive\n\n${session.summary.deepDive}\n\n`;
    }
    
    if (session.visualMap) {
      md += `## Mental Architecture\n\n${session.visualMap}\n\n`;
    }
    
    if (session.quiz && session.quiz.length > 0) {
      md += `## Knowledge Quiz\n\n`;
      session.quiz.forEach((q, i) => {
        md += `### Q${i + 1}: ${q.question}\n`;
        q.options.forEach((opt, oi) => {
          md += `- ${String.fromCharCode(65 + oi)}) ${opt}\n`;
        });
        md += `\n**Correct Answer:** ${String.fromCharCode(65 + q.correctAnswer)}\n`;
        md += `**Explanation:** ${q.explanation}\n\n`;
      });
    }

    const blob = new Blob([md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${session.title.replace(/\s+/g, '_')}_Prodigy.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Notification Permission & Checking
  useEffect(() => {
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }

    const interval = setInterval(() => {
      const now = new Date();
      setReminders(prev => {
        let changed = false;
        const nextReminders = prev.map(r => {
          if (!r.isCompleted && new Date(r.time) <= now) {
            // Trigger Notification
            if (Notification.permission === "granted") {
              new Notification("Prodigy. Alert!", {
                body: `Time to study: ${r.topic}`,
                icon: "/favicon.ico"
              });
            }
            changed = true;
            return { ...r, isCompleted: true };
          }
          return r;
        });
        return changed ? nextReminders : prev;
      });
    }, 30000); // Check every 30 seconds

    return () => clearInterval(interval);
  }, []);

  const addReminder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newReminder.topic || !newReminder.date || !newReminder.time) return;

    const reminderDate = new Date(`${newReminder.date}T${newReminder.time}`);
    const reminder: StudyReminder = {
      id: Math.random().toString(36).substr(2, 9),
      topic: newReminder.topic,
      time: reminderDate.toISOString(),
      isCompleted: false
    };

    if (user) {
      await saveReminder(user.uid, reminder);
    } else {
      setReminders([...reminders, reminder]);
    }
    setNewReminder({ topic: '', time: '', date: '' });
  };

  const deleteReminder = async (id: string) => {
    if (user) {
      await deleteReminderFromDb(user.uid, id);
    } else {
      setReminders(reminders.filter(r => r.id !== id));
    }
  };

  const onDrop = async (acceptedFiles: File[]) => {
    if (acceptedFiles.length === 0) return;
    const file = acceptedFiles[0];
    
    setProcessing({ isProcessing: true, step: 'ocr' });
    try {
      const base64 = await fileToBase64(file);
      const mimeType = file.type;
      
      const result = await processStudyMaterial({ data: base64, mimeType }, examType, secondaryDetails);
      
      const sessionData: StudySession = {
        id: Math.random().toString(36).substr(2, 9),
        title: result.title || file.name,
        timestamp: Date.now(),
        examType,
        refinedNotes: result.refinedNotes,
        summary: {
          feynman: result.feynmanSummary,
          deepDive: result.deepDive
        },
        visualMap: result.visualMap
      };

      if (user) {
        await saveSession(user.uid, sessionData);
      } else {
        setSessions([sessionData, ...sessions]);
      }
      setCurrentSession(sessionData);
      
      setProcessing({ isProcessing: true, step: 'quizzing' });
      const quiz = await generateQuiz(result.refinedNotes, examType, secondaryDetails);
      
      const finalSession = { ...sessionData, quiz };
      if (user) {
        await saveSession(user.uid, finalSession);
      } else {
        setSessions(prev => prev.map(s => s.id === sessionData.id ? finalSession : s));
      }
      setCurrentSession(finalSession);
      
      setProcessing({ isProcessing: false, step: 'idle' });
    } catch (error) {
      console.error(error);
      setProcessing({ isProcessing: false, step: 'idle', error: 'Failed to process material. Please try again.' });
    }
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({ 
    onDrop,
    accept: {
      'image/*': ['.png', '.jpg', '.jpeg'],
      'application/pdf': ['.pdf']
    },
    multiple: false
  });

  const handleQuizAnswer = (qId: string, index: number, correctIndex: number) => {
    setQuizProgress(prev => ({
      ...prev,
      [qId]: {
        ...prev[qId],
        selected: index,
        isCorrect: index === correctIndex
      }
    }));
  };

  const toggleHint = (qId: string) => {
    setQuizProgress(prev => ({
      ...prev,
      [qId]: { ...prev[qId], showHint: !prev[qId]?.showHint }
    }));
  };

  return (
    <div className="min-h-screen bg-slate-50 text-indigo-950 font-sans selection:bg-indigo-100">
      {/* --- Navigation Bar --- */}
      <nav className="bg-white/80 backdrop-blur-md border-b border-indigo-100 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="bg-indigo-600 p-2 rounded-xl text-white">
              <GraduationCap size={24} />
            </div>
            <span className="text-xl font-bold tracking-tight text-indigo-900">Prodigy.</span>
          </div>
          
          <div className="flex items-center gap-4">
            {/* Reminders / Alert System */}
            <button 
              onClick={() => setShowRemindersModal(true)}
              className="flex items-center gap-3 px-5 py-2.5 bg-indigo-50 hover:bg-slate-900 border border-indigo-100 rounded-2xl transition-all group relative hover:text-white hover:scale-105"
            >
              <div className="relative">
                <Bell size={24} className="text-indigo-600 group-hover:text-indigo-400 group-hover:rotate-12 transition-all" />
                {reminders.filter(r => !r.isCompleted).length > 0 && (
                  <span className="absolute -top-3 -right-3 min-w-[22px] h-5.5 px-1.5 bg-rose-600 text-white text-[10px] font-black rounded-full flex items-center justify-center ring-2 ring-white shadow-lg animate-bounce">
                    {reminders.filter(r => !r.isCompleted).length}
                  </span>
                )}
              </div>
              <div className="text-left hidden sm:block">
                <p className="text-[10px] font-black uppercase tracking-widest text-indigo-400 group-hover:text-indigo-300 leading-none mb-0.5">Study Focus</p>
                <p className="text-sm font-bold leading-tight">Reminders</p>
              </div>
            </button>
            
            <UserAvatar user={user} onClick={() => setShowAuthModal(true)} />
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <AITutorChat examType={examType} secondaryDetails={secondaryDetails} user={user} />

        {!user && !isInitializing && (
          <motion.div 
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-6 p-4 bg-indigo-900 border border-indigo-800 rounded-2xl flex flex-col sm:flex-row items-center justify-between gap-4 shadow-lg shadow-indigo-100"
          >
            <div className="flex items-center gap-3">
              <div className="p-2 bg-indigo-800 rounded-xl text-indigo-300">
                <Sparkles size={20} />
              </div>
              <p className="text-sm font-bold text-indigo-100">
                You're in study mode! Sign in to sync your sessions and track your progress across devices.
              </p>
            </div>
            <Button onClick={() => setShowAuthModal(true)} variant="secondary" className="w-full sm:w-auto h-10 px-6 text-sm">
              Sign In Now
            </Button>
          </motion.div>
        )}

        {isInitializing ? (
          <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
            <Loader2 className="animate-spin text-indigo-600" size={32} />
            <p className="text-indigo-400 font-medium">Initializing Academic Architect...</p>
          </div>
        ) : !currentSession && !processing.isProcessing ? (
          /* --- Hero / Welcome Section --- */
          <div className="flex flex-col items-center justify-center min-h-[70vh] text-center max-w-3xl mx-auto">
            <div className="flex flex-col md:flex-row items-center justify-between gap-6 mb-12">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-indigo-600 rounded-2xl text-white shadow-lg shadow-indigo-200">
                  <Sparkles size={24} />
                </div>
                <div className="text-left">
                  <h2 className="text-2xl font-bold text-indigo-950">Academic Level {Math.floor((profile?.points || 0) / 100) + 1}</h2>
                  <p className="text-indigo-500 text-sm font-medium">You have {profile?.points || 0} Architect Points</p>
                </div>
              </div>
              
              <div className="flex gap-2">
                <div className="px-4 py-2 bg-white border border-indigo-100 rounded-xl shadow-sm text-center min-w-[100px]">
                  <p className="text-[10px] font-black uppercase text-indigo-400">Daily Streak</p>
                  <p className="text-lg font-black text-indigo-600">{profile?.dailyStreak || 0} 🔥</p>
                </div>
                <div className="px-4 py-2 bg-indigo-950 text-white rounded-xl shadow-sm text-center min-w-[100px]">
                  <p className="text-[10px] font-black uppercase text-indigo-400">Rank</p>
                  <p className="text-lg font-black">{profile?.points > 500 ? 'Pro' : 'Elite'}</p>
                </div>
              </div>
            </div>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-6"
            >
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-indigo-100 text-indigo-700 text-sm font-semibold mb-4">
                <Sparkles size={16} />
                <span>Your AI Academic Architect</span>
              </div>
              <h1 className="text-4xl sm:text-5xl md:text-6xl font-extrabold text-indigo-950 leading-tight">
                Transform messy notes into <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-600 to-violet-600">mastery.</span>
              </h1>
              <p className="text-lg text-indigo-700/80 leading-relaxed font-medium">
                Upload handwritten notes, lecture PDFs, or text. We'll handle the OCR, summarize using the Feynman Technique, and build a custom study ecosystem for your {examType} exams.
              </p>

              {/* Upload Area */}
              <div 
                {...getRootProps()} 
                className={cn(
                  "mt-10 p-8 sm:p-12 border-2 border-dashed rounded-3xl transition-all cursor-pointer bg-white group",
                  isDragActive ? "border-indigo-500 bg-indigo-50" : "border-indigo-200 hover:border-indigo-400"
                )}
              >
                <input {...getInputProps()} />
                <div className="flex flex-col items-center">
                  <div className="p-4 bg-indigo-50 rounded-2xl text-indigo-600 group-hover:scale-110 transition-transform duration-300">
                    <Upload size={40} />
                  </div>
                  <p className="mt-4 text-lg font-semibold text-indigo-900">
                    {isDragActive ? "Drop the files here" : "Click or drag notes/PDF here"}
                  </p>
                  <p className="text-indigo-400 text-sm mt-1">Images of handwriting, PDFs, or lecture slides supported</p>
                </div>
              </div>

              <div className="mt-12 w-full grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 text-left">
                {/* 1. Daily Puzzle */}
                <DailyPuzzle examType={examType} user={user} />

                {/* 2. Recent Sessions */}
                <div className="space-y-4">
                  <h3 className="text-lg font-bold flex items-center gap-2">
                    <BookOpen size={20} className="text-indigo-600" />
                    Recent Sessions
                  </h3>
                  <div className="grid grid-cols-1 gap-4">
                    {sessions.length > 0 ? sessions.slice(0, 2).map(s => (
                      <button
                        key={s.id}
                        onClick={() => setCurrentSession(s)}
                        className="flex items-center gap-4 p-4 bg-white rounded-2xl border border-indigo-50 hover:border-indigo-200 transition-all text-left shadow-sm group"
                      >
                        <div className="p-2 bg-indigo-50 rounded-lg text-indigo-600 group-hover:bg-indigo-600 group-hover:text-white transition-colors">
                          <ClipboardList size={20} />
                        </div>
                        <div className="min-w-0">
                          <p className="font-bold text-indigo-900 truncate">{s.title}</p>
                          <p className="text-[10px] text-indigo-400 font-bold uppercase tracking-widest">{new Date(s.timestamp).toLocaleDateString()}</p>
                        </div>
                        <ChevronRight className="ml-auto text-indigo-200 group-hover:text-indigo-500 transition-colors shrink-0" size={20} />
                      </button>
                    )) : (
                      <div className="p-8 border-2 border-dashed border-indigo-50 rounded-2xl text-center">
                        <p className="text-sm text-indigo-300 font-medium italic">No sessions yet...</p>
                      </div>
                    )}
                  </div>
                </div>

                {/* 3. Study Alerts Box */}
                <div className="space-y-4">
                  <h3 className="text-lg font-bold flex items-center gap-2">
                    <Bell size={20} className="text-indigo-600" />
                    Focus Alerts
                  </h3>
                  <div 
                    onClick={() => setShowRemindersModal(true)}
                    className="p-6 bg-slate-900 rounded-3xl text-white shadow-xl cursor-pointer hover:scale-[1.02] transition-all group relative overflow-hidden"
                  >
                    <div className="absolute top-0 right-0 p-8 opacity-10 group-hover:scale-125 transition-transform duration-500">
                      <Clock size={80} />
                    </div>
                    <div className="relative z-10 space-y-4">
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-1 bg-indigo-600 rounded text-[10px] font-black uppercase tracking-widest">Active Schedule</span>
                        <div className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse" />
                      </div>
                      
                      {reminders.filter(r => !r.isCompleted).length > 0 ? (
                        <div>
                          <p className="text-2xl font-black leading-tight truncate">
                            {reminders.filter(r => !r.isCompleted)[0].topic}
                          </p>
                          <p className="text-indigo-300 text-sm font-bold flex items-center gap-2 mt-1">
                            <Clock size={14} />
                            {new Date(reminders.filter(r => !r.isCompleted)[0].time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </p>
                        </div>
                      ) : (
                        <div>
                          <p className="text-xl font-bold opacity-60">No pending alerts</p>
                          <p className="text-sm opacity-40">Plan your next study marathon</p>
                        </div>
                      )}

                      <div className="pt-2">
                        <button className="text-xs font-black uppercase tracking-widest flex items-center gap-2 text-indigo-400 group-hover:text-white transition-colors">
                          Open Scheduler <ChevronRight size={14} />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        ) : processing.isProcessing ? (
          /* --- Loading / Processing View --- */
          <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-8 animate-in fade-in duration-700">
            <div className="relative">
              <div className="w-24 h-24 border-4 border-indigo-100 border-t-indigo-600 rounded-full animate-spin"></div>
              <div className="absolute inset-0 flex items-center justify-center">
                <GraduationCap size={32} className="text-indigo-600" />
              </div>
            </div>
            
            <div className="text-center space-y-4">
              <h2 className="text-2xl font-bold text-indigo-900">
                {processing.step === 'ocr' && "Reading your notes..."}
                {processing.step === 'refining' && "Polishing the transcription..."}
                {processing.step === 'summarizing' && "Applying Feynman Technique..."}
                {processing.step === 'quizzing' && "Crafting high-stakes questions..."}
                {processing.step === 'mapping' && "Visualizing the mental map..."}
              </h2>
              <p className="text-indigo-500 max-w-sm mx-auto">
                Our AI Academic Architect is hard at work building your personalized study ecosystem.
              </p>
            </div>

            <div className="w-64 h-2 bg-indigo-100 rounded-full overflow-hidden">
              <motion.div 
                className="h-full bg-indigo-600"
                initial={{ width: "0%" }}
                animate={{ width: "100%" }}
                transition={{ duration: 15, repeat: Infinity }}
              />
            </div>
          </div>
        ) : currentSession && (
          /* --- Main Session Dashboard --- */
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
            {/* Sidebar / Outline */}
            <div className="lg:col-span-3 space-y-4">
              <Button 
                variant="outline" 
                className="w-full justify-start text-sm"
                onClick={() => setCurrentSession(null)}
              >
                ← Back to Dashboard
              </Button>
              
              <div className="space-y-1">
                {[
                  { id: 'refined', icon: ClipboardList, label: 'Refined Notes' },
                  { id: 'feynman', icon: Lightbulb, label: 'Feynman Summary' },
                  { id: 'deep-dive', icon: BookOpen, label: 'Deep Dive' },
                  { id: 'visual-map', icon: MapIcon, label: 'Mental Map' },
                  { id: 'quiz', icon: Sparkles, label: 'Knowledge Quiz' }
                ].map(item => (
                   <a 
                    key={item.id}
                    href={`#${item.id}`}
                    className="flex items-center gap-3 p-3 rounded-lg hover:bg-indigo-50 text-indigo-700/80 hover:text-indigo-900 transition-colors font-medium text-sm"
                   >
                     <item.icon size={18} />
                     {item.label}
                   </a>
                ))}
              </div>

              <div className="p-4 bg-indigo-900 rounded-2xl text-white space-y-4">
                <p className="text-sm font-semibold opacity-80 uppercase tracking-widest">{examType} SPECIALIST</p>
                <p className="text-xs italic leading-relaxed">
                  "The first principle is that you must not fool yourself, and you are the easiest person to fool." — Richard Feynman
                </p>
              </div>
            </div>

            {/* Main Content Area */}
            <div className="lg:col-span-9 space-y-8 pb-20">
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <h1 className="text-3xl font-black text-indigo-950 uppercase tracking-tight truncate">{currentSession.title}</h1>
                  <div className="inline-flex items-center bg-indigo-100 px-3 py-1 rounded-lg text-indigo-600 text-[10px] font-black ring-1 ring-indigo-200 uppercase mt-1">
                    {currentSession.examType} Focus
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button 
                    onClick={() => exportToMarkdown(currentSession)}
                    variant="secondary"
                    className="shrink-0 h-11 px-4 shadow-sm border-indigo-100"
                  >
                    <Download size={18} />
                    <span className="hidden sm:inline">MD</span>
                  </Button>
                  <Button 
                    onClick={() => window.print()}
                    variant="secondary"
                    className="shrink-0 h-11 px-4 shadow-sm border-indigo-100"
                  >
                    <FileText size={18} />
                    <span className="hidden sm:inline">PDF</span>
                  </Button>
                </div>
              </div>

              {/* 1. Refined Notes */}
              <Card id="refined">
                <div className="flex items-center gap-2 mb-6">
                  <div className="p-2 bg-indigo-50 rounded-lg text-indigo-600">
                    <ClipboardList size={20} />
                  </div>
                  <h3 className="text-xl font-bold">OCR & Refined Notes</h3>
                </div>
                <Markdown content={currentSession.refinedNotes || ''} />
              </Card>

              {/* 2. Feynman Summary */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <Card id="feynman" className="border-l-4 border-l-amber-400">
                  <div className="flex items-center gap-2 mb-4">
                    <div className="p-2 bg-amber-50 rounded-lg text-amber-600">
                      <Lightbulb size={20} />
                    </div>
                    <h3 className="text-lg font-bold">The Feynman Bridge</h3>
                  </div>
                  <p className="text-xs text-amber-600 font-bold mb-4 uppercase tracking-widest">Concept Simplified</p>
                  <div className="text-indigo-900/90 italic leading-relaxed">
                    <Markdown content={currentSession.summary?.feynman || ''} />
                  </div>
                </Card>

                <Card id="deep-dive" className="bg-indigo-950 text-indigo-50">
                  <div className="flex items-center gap-2 mb-4">
                    <div className="p-2 bg-indigo-900 rounded-lg text-indigo-400">
                      <BookOpen size={20} />
                    </div>
                    <h3 className="text-lg font-bold">Deep Dive</h3>
                  </div>
                  <p className="text-xs text-indigo-400 font-bold mb-4 uppercase tracking-widest">Technical Precision</p>
                  <div className="text-indigo-100/90 text-sm leading-relaxed">
                    <Markdown content={currentSession.summary?.deepDive || ''} />
                  </div>
                </Card>
              </div>

              {/* 3. Visual Map */}
              <Card id="visual-map">
                <div className="flex items-center gap-2 mb-6">
                  <div className="p-2 bg-emerald-50 rounded-lg text-emerald-600">
                    <MapIcon size={20} />
                  </div>
                  <h3 className="text-xl font-bold">Mental Architecture</h3>
                </div>
                <div className="bg-emerald-50/30 p-6 rounded-xl border border-emerald-100">
                  <Markdown content={currentSession.visualMap || ''} />
                </div>
              </Card>

              {/* 4. Smart Quiz */}
              <Card id="quiz" className="bg-white border-2 border-indigo-600 overflow-visible relative">
                <div className="absolute -top-4 -right-4 bg-indigo-600 text-white p-3 rounded-2xl shadow-xl rotate-12">
                  <Sparkles size={24} />
                </div>
                
                <div className="mb-8">
                  <h3 className="text-2xl font-black text-indigo-950">SMART KNOWLEDGE CHECK</h3>
                  <p className="text-indigo-500 font-medium">{examType}-specific analytical training</p>
                </div>

                {!currentSession.quiz ? (
                  <div className="py-12 flex flex-col items-center gap-4">
                    <Loader2 className="animate-spin text-indigo-600" size={32} />
                    <p className="text-indigo-400 font-medium">Synthesizing questions...</p>
                  </div>
                ) : (
                  <div className="space-y-12">
                    {currentSession.quiz.map((q, idx) => (
                      <div key={q.id} className="space-y-6">
                        <div className="flex items-start gap-4">
                          <span className="text-4xl font-black text-indigo-100 shrink-0">0{idx + 1}</span>
                          <p className="text-xl font-bold text-indigo-900 pt-2 leading-snug">{q.question}</p>
                        </div>

                        <div className="grid grid-cols-1 gap-3 ml-14">
                          {q.options.map((opt, oIdx) => {
                             const state = quizProgress[q.id];
                             const isSelected = state?.selected === oIdx;
                             const isCorrect = oIdx === q.correctAnswer;
                             
                             return (
                               <button
                                 key={oIdx}
                                 disabled={state?.selected !== null}
                                 onClick={() => handleQuizAnswer(q.id, oIdx, q.correctAnswer)}
                                 className={cn(
                                   "p-4 rounded-xl text-left border transition-all flex items-center gap-4 group",
                                   isSelected 
                                     ? state.isCorrect 
                                       ? "bg-emerald-50 border-emerald-200 text-emerald-900" 
                                       : "bg-rose-50 border-rose-200 text-rose-900"
                                     : state?.selected !== null && isCorrect
                                       ? "bg-emerald-50 border-emerald-200 text-emerald-900 opacity-60"
                                       : "bg-indigo-50/30 border-indigo-100 hover:border-indigo-300 text-indigo-900"
                                 )}
                               >
                                 <div className={cn(
                                   "w-6 h-6 rounded-full border-2 flex items-center justify-center text-xs font-bold shrink-0",
                                   isSelected
                                    ? state.isCorrect ? "border-emerald-500 bg-emerald-500 text-white" : "border-rose-500 bg-rose-500 text-white"
                                    : "border-indigo-200 text-indigo-300 group-hover:border-indigo-400"
                                 )}>
                                   {String.fromCharCode(65 + oIdx)}
                                 </div>
                                 <span className="font-medium">{opt}</span>
                               </button>
                             );
                          })}
                        </div>

                        <div className="ml-14 flex items-center gap-4">
                          <button 
                            onClick={() => toggleHint(q.id)}
                            className="text-xs font-black uppercase tracking-widest text-indigo-400 hover:text-indigo-600 transition-colors flex items-center gap-1"
                          >
                            <Lightbulb size={14} />
                            {quizProgress[q.id]?.showHint ? "Hide Hint" : "Need a Hint?"}
                          </button>
                        </div>

                        <AnimatePresence>
                          {quizProgress[q.id]?.showHint && (
                            <motion.div 
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: 'auto', opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              className="ml-14 overflow-hidden"
                            >
                               <div className="bg-amber-50 p-4 rounded-xl border border-amber-100 text-sm text-amber-900 italic">
                                 <strong>Professor's Tip:</strong> {q.hint}
                               </div>
                            </motion.div>
                          )}
                        </AnimatePresence>

                        {quizProgress[q.id]?.selected !== null && (
                          <motion.div 
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={{ opacity: 1, scale: 1 }}
                            className={cn(
                              "ml-14 p-4 rounded-xl border",
                              quizProgress[q.id].isCorrect ? "bg-emerald-50 border-emerald-100" : "bg-rose-50 border-rose-100"
                            )}
                          >
                            <p className="text-sm">
                              <strong className="uppercase mr-2 font-black">{quizProgress[q.id].isCorrect ? "Mastery Achieved!" : "Learning Opportunity:"}</strong>
                              {q.explanation}
                            </p>
                          </motion.div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            </div>
          </div>
        )}
      </main>

      {/* Footer Meta */}
      <footer className="border-t border-indigo-100 py-12 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col md:flex-row justify-between items-center gap-8">
          <div className="flex items-center gap-2">
            <div className="bg-indigo-600 p-1.5 rounded-lg text-white">
              <GraduationCap size={16} />
            </div>
            <span className="text-sm font-bold tracking-tight text-indigo-900">Prodigy.</span>
          </div>
          <div className="text-center md:text-left">
            <p className="text-xs text-indigo-400 font-medium">Built for the future of academic excellence. Powered by Prodigy Intelligence.</p>
            <p className="text-[10px] font-black uppercase tracking-widest text-indigo-300 mt-1">this app is made by VISHAL DHULE</p>
          </div>
          <div className="flex gap-6 text-xs font-black uppercase tracking-widest text-indigo-300">
             <a href="#" className="hover:text-indigo-600 transition-colors">UPSC Guide</a>
             <a href="#" className="hover:text-indigo-600 transition-colors">JEE Mastery</a>
             <a href="#" className="hover:text-indigo-600 transition-colors">BCA Logic</a>
          </div>
        </div>
      </footer>

      {/* --- Reminders Modal --- */}
      <AnimatePresence>
        {showRemindersModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowRemindersModal(false)}
              className="absolute inset-0 bg-indigo-950/40 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative bg-white w-full max-w-md rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[95vh]"
            >
              <div className="p-6 sm:p-8 overflow-y-auto custom-scrollbar">
              <div className="flex items-center justify-between mb-8">
                <div>
                  <h2 className="text-2xl font-black text-indigo-950 uppercase tracking-tight">Study Alerts</h2>
                  <p className="text-indigo-400 text-sm font-medium">Schedule your next mastery session</p>
                </div>
                <button 
                  onClick={() => setShowRemindersModal(false)}
                  className="p-2 hover:bg-indigo-50 rounded-full text-indigo-300 hover:text-indigo-600 transition-colors"
                >
                  <X size={24} />
                </button>
              </div>

              <form onSubmit={addReminder} className="space-y-4 mb-8">
                <div className="space-y-1">
                  <label className="text-xs font-black text-indigo-400 uppercase tracking-widest px-1">Study Topic</label>
                  <input 
                    type="text" 
                    required
                    placeholder="e.g. Modern Physics (JEE)"
                    className="w-full bg-indigo-50 border-none rounded-xl p-3 text-indigo-900 placeholder:text-indigo-300 focus:ring-2 focus:ring-indigo-600"
                    value={newReminder.topic}
                    onChange={e => setNewReminder({...newReminder, topic: e.target.value})}
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-xs font-black text-indigo-400 uppercase tracking-widest px-1">Date</label>
                    <input 
                      type="date" 
                      required
                      className="w-full bg-indigo-50 border-none rounded-xl p-3 text-indigo-900 focus:ring-2 focus:ring-indigo-600"
                      value={newReminder.date}
                      onChange={e => setNewReminder({...newReminder, date: e.target.value})}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-black text-indigo-400 uppercase tracking-widest px-1">Time</label>
                    <input 
                      type="time" 
                      required
                      className="w-full bg-indigo-50 border-none rounded-xl p-3 text-indigo-900 focus:ring-2 focus:ring-indigo-600"
                      value={newReminder.time}
                      onChange={e => setNewReminder({...newReminder, time: e.target.value})}
                    />
                  </div>
                </div>
                <Button type="submit" className="w-full h-12">
                  <Plus size={20} />
                  Register Alert
                </Button>
              </form>

              <div className="space-y-4 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
                <h3 className="text-xs font-black text-indigo-400 uppercase tracking-widest px-1">Upcoming Alerts</h3>
                {reminders.length === 0 ? (
                  <div className="text-center py-8 bg-indigo-50/50 rounded-2xl border-2 border-dashed border-indigo-100">
                    <p className="text-indigo-400 text-sm">No active alerts scheduled.</p>
                  </div>
                ) : (
                  reminders.sort((a,b) => new Date(a.time).getTime() - new Date(b.time).getTime()).map(r => (
                    <div key={r.id} className={cn(
                      "flex items-center gap-4 p-4 rounded-2xl border transition-all",
                      r.isCompleted ? "bg-indigo-50/30 border-transparent opacity-60" : "bg-white border-indigo-50 shadow-sm"
                    )}>
                      <div className={cn(
                        "p-2 rounded-lg",
                        r.isCompleted ? "bg-indigo-100 text-indigo-400" : "bg-indigo-600 text-white"
                      )}>
                        <Clock size={16} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className={cn("font-bold text-indigo-900 truncate", r.isCompleted && "line-through")}>{r.topic}</p>
                        <p className="text-[10px] uppercase font-black tracking-widest text-indigo-400">
                          {new Date(r.time).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
                        </p>
                      </div>
                      <button 
                        onClick={() => deleteReminder(r.id)}
                        className="p-2 text-indigo-200 hover:text-rose-500 transition-colors"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          </motion.div>
          </div>
        )}
      </AnimatePresence>
      {/* --- Auth/Account Modal --- */}
      <AnimatePresence>
        {showAuthModal && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowAuthModal(false)}
              className="absolute inset-0 bg-indigo-950/40 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative bg-white w-full max-w-sm rounded-[2rem] shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
            >
              <div className="p-8 text-center space-y-6 overflow-y-auto custom-scrollbar">
                {!user ? (
                  <>
                    <div className="mx-auto w-16 h-16 bg-indigo-100 rounded-2xl flex items-center justify-center text-indigo-600">
                      <GraduationCap size={32} />
                    </div>
                    <div>
                      <h2 className="text-2xl font-black text-indigo-900 uppercase tracking-tight">Academic Profile</h2>
                      <p className="text-indigo-400 text-sm font-medium">Continue your journey to mastery</p>
                    </div>
                    <Button onClick={() => { signInWithGoogle(); setShowAuthModal(false); }} className="w-full h-12">
                      <img src="https://www.google.com/favicon.ico" className="w-5 h-5 mr-1" alt="Google" />
                      Sign in with Google
                    </Button>
                  </>
                ) : (
                  <>
                    <div className="relative mx-auto w-24 h-24">
                      {user.photoURL && <img src={user.photoURL} alt="Profile" className="w-full h-full rounded-3xl object-cover shadow-lg border-2 border-white" referrerPolicy="no-referrer" />}
                      <div className="absolute -bottom-2 -right-2 bg-emerald-500 text-white p-2 rounded-xl shadow-lg">
                        <Sparkles size={16} />
                      </div>
                    </div>
                    <div>
                      <h2 className="text-xl font-black text-indigo-900 truncate">{user.displayName}</h2>
                      <p className="text-[10px] font-black text-indigo-400 uppercase tracking-widest mb-4">Current Track: {profile?.examType || examType}</p>
                    </div>

                    <div className="space-y-4 text-left">
                      <div className="space-y-1">
                        <label className="text-[10px] font-black text-indigo-300 uppercase px-2 tracking-widest">Secondary Details</label>
                        <input 
                          type="text"
                          placeholder="e.g. 2026 Batch, Neuro Surgery, etc."
                          className="w-full bg-indigo-50 border-none rounded-xl p-3 text-sm text-indigo-900 placeholder:text-indigo-300 focus:ring-2 focus:ring-indigo-600 transition-all font-medium"
                          value={secondaryDetails}
                          onBlur={async () => {
                            if (user) {
                              const { doc, setDoc } = await import('firebase/firestore');
                              const { db } = await import('./services/firebase');
                              await setDoc(doc(db, 'users', user.uid), { secondaryDetails }, { merge: true });
                            }
                          }}
                          onChange={e => setSecondaryDetails(e.target.value)}
                        />
                      </div>

                      <div className="space-y-2 max-h-[200px] overflow-y-auto pr-2 custom-scrollbar">
                        <p className="text-[10px] font-black text-indigo-300 uppercase px-2 tracking-widest">Select Academic Track</p>
                        {TRACKS.map(track => (
                          <button
                            key={track.id}
                            onClick={async () => {
                              setExamType(track.id);
                              if (user) {
                                const { doc, setDoc } = await import('firebase/firestore');
                                const { db } = await import('./services/firebase');
                                await setDoc(doc(db, 'users', user.uid), { examType: track.id }, { merge: true });
                              }
                            }}
                            className={cn(
                              "w-full flex items-center gap-3 p-3 rounded-2xl transition-all border",
                              (profile?.examType || examType) === track.id 
                                ? "bg-indigo-600 text-white border-transparent" 
                                : "bg-indigo-50 text-indigo-900 border-indigo-100 hover:border-indigo-300"
                            )}
                          >
                            <div className={cn("p-1.5 rounded-lg text-white", (profile?.examType || examType) === track.id ? "bg-white/20" : track.color)}>
                              <track.icon size={14} />
                            </div>
                            <span className="text-sm font-bold">{track.label}</span>
                            {(profile?.examType || examType) === track.id && <ChevronRight size={14} className="ml-auto" />}
                          </button>
                        ))}
                      </div>
                    </div>
                    
                    <div className="grid grid-cols-2 gap-3 pb-4">
                      <div className="p-3 bg-indigo-50 rounded-2xl">
                        <p className="text-[10px] font-black text-indigo-400 uppercase">Streak</p>
                        <p className="text-lg font-black text-indigo-900">{profile?.dailyStreak || 0} Days</p>
                      </div>
                      <div className="p-3 bg-indigo-50 rounded-2xl">
                        <p className="text-[10px] font-black text-indigo-400 uppercase">Points</p>
                        <p className="text-lg font-black text-indigo-900">{profile?.points || 0}</p>
                      </div>
                    </div>

                    <Button variant="outline" onClick={() => { logout(); setShowAuthModal(false); }} className="w-full border-rose-100 text-rose-500 hover:bg-rose-50 hover:border-rose-200">
                      Sign Out
                    </Button>
                  </>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
      {/* --- Track Onboarding Modal --- */}
      <AnimatePresence>
        {showTrackModal && (
          <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-indigo-950/60 backdrop-blur-md"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 30 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 30 }}
              className="relative bg-white w-full max-w-2xl rounded-[3rem] shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
            >
              <div className="p-6 sm:p-10 text-center space-y-8 overflow-y-auto custom-scrollbar">
                <div className="mx-auto w-20 h-20 bg-indigo-600 text-white rounded-[2rem] flex items-center justify-center shadow-xl shadow-indigo-200">
                  <Sparkles size={40} />
                </div>
                
                <div className="space-y-2">
                  <h2 className="text-3xl font-black text-indigo-900 leading-tight">CHOOSE YOUR MISSION</h2>
                  <p className="text-indigo-500 font-medium max-w-sm mx-auto">To customize your learning intelligence, please select your primary academic track.</p>
                </div>

                <div className="space-y-6">
                  <div className="space-y-2 text-left max-w-md mx-auto">
                    <label className="text-[10px] font-black text-indigo-300 uppercase px-2 tracking-widest">Secondary Details (Optional)</label>
                    <input 
                      type="text" 
                      placeholder="e.g. Target Exam Year, Specific Subjects, Focus Areas"
                      className="w-full bg-indigo-50 border-2 border-transparent rounded-[1.5rem] p-4 text-indigo-900 placeholder:text-indigo-300 focus:ring-2 focus:ring-indigo-600 focus:bg-white transition-all font-medium"
                      value={secondaryDetails}
                      onChange={e => setSecondaryDetails(e.target.value)}
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {TRACKS.map(track => (
                      <button
                        key={track.id}
                        onClick={async () => {
                          setExamType(track.id);
                          setShowTrackModal(false);
                          if (user) {
                            const { doc, setDoc } = await import('firebase/firestore');
                            const { db } = await import('./services/firebase');
                            await setDoc(doc(db, 'users', user.uid), { examType: track.id, secondaryDetails }, { merge: true });
                          }
                        }}
                        className="group flex items-center gap-4 p-5 bg-indigo-50 hover:bg-indigo-600 transition-all rounded-[2rem] text-left border border-indigo-100 hover:border-transparent"
                      >
                        <div className={cn("p-3 rounded-2xl text-white shadow-lg transition-transform group-hover:scale-110", track.color)}>
                          <track.icon size={24} />
                        </div>
                        <div>
                          <p className="text-sm font-black text-indigo-900 group-hover:text-white transition-colors">{track.label}</p>
                          <p className="text-[10px] font-bold text-indigo-400 group-hover:text-indigo-200 uppercase tracking-widest transition-colors">{track.id} Track</p>
                        </div>
                        <ChevronRight className="ml-auto text-indigo-200 group-hover:text-white transition-colors" size={20} />
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
