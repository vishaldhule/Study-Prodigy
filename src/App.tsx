import React, { useState, useEffect } from 'react';
import { BookOpen, Upload, ClipboardList, Lightbulb, Map as MapIcon, GraduationCap, ChevronRight, Loader2, Sparkles, Bell, Clock, Trash2, X, Plus, Download, FileText, Scale, Landmark, Cog, Calculator, Activity, Code, Send, Moon, Sun, ChevronDown, Youtube } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import { useDropzone } from 'react-dropzone';

import { cn, fileToBase64 } from './lib/utils';
import { ExamType, StudySession, QuizQuestion, ProcessingState, StudyReminder } from './types';
import { processStudyMaterial, generateQuiz, generatePuzzleBatch, processYouTubeVideo } from './services/gemini';

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
      variant === 'secondary' && "bg-white dark:bg-indigo-950 text-indigo-900 dark:text-indigo-100 hover:bg-indigo-50 dark:hover:bg-indigo-900 border border-indigo-100 dark:border-indigo-900",
      variant === 'outline' && "bg-transparent border-2 border-indigo-200 dark:border-indigo-800 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950",
      className
    )}
  />
);

const ThemeToggle = ({ theme, toggle }: { theme: 'light' | 'dark'; toggle: () => void }) => (
  <button
    onClick={toggle}
    className="p-2.5 rounded-2xl bg-indigo-50 dark:bg-indigo-950 border border-indigo-100 dark:border-indigo-900 text-indigo-600 dark:text-indigo-400 hover:scale-105 active:scale-95 transition-all shadow-sm"
    title={theme === 'light' ? 'Switch to Dark Mode' : 'Switch to Light Mode'}
  >
    {theme === 'light' ? <Moon size={20} /> : <Sun size={20} />}
  </button>
);

const UserAvatar = ({ user, onClick }: { user: User | null; onClick: () => void }) => (
  <button onClick={onClick} className="flex items-center gap-2 p-1 pl-3 bg-white dark:bg-indigo-950 border border-indigo-100 dark:border-indigo-900 rounded-full hover:bg-indigo-50 dark:hover:bg-indigo-900 transition-colors">
    <div className="text-right hidden sm:block">
      <p className="text-[10px] font-black uppercase text-black dark:text-indigo-400">Student</p>
      <p className="text-xs font-bold text-black dark:text-indigo-100">{user?.displayName?.split(' ')[0] || 'Account'}</p>
    </div>
    <div className="w-8 h-8 rounded-full overflow-hidden bg-indigo-100 dark:bg-indigo-900">
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
  <div id={id} className={cn("bg-white dark:bg-indigo-950/40 rounded-2xl border border-indigo-50 dark:border-indigo-900 shadow-sm p-6 overflow-hidden backdrop-blur-sm", className)}>
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

const DailyPuzzle = ({ examType, secondaryDetails, user, sessions }: { examType: ExamType, secondaryDetails: string, user: User | null, sessions: StudySession[] }) => {
  const [status, setStatus] = useState<'idle' | 'solving' | 'done' | 'loading' | 'failed'>('loading');
  const [isWrong, setIsWrong] = useState(false);
  const [answer, setAnswer] = useState('');
  const [puzzleStack, setPuzzleStack] = useState<{ id: string; question: string; answer: string; hint: string; difficulty: string; topic: string }[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [showHint, setShowHint] = useState(false);

  useEffect(() => {
    loadBatch();
  }, [examType]);

  const loadBatch = async () => {
    setStatus('loading');
    setAnswer('');
    setIsWrong(false);
    setShowHint(false);
    setCurrentIndex(0);
    try {
      const recentLearnings = sessions.slice(0, 5).map(s => (s.title + ": " + s.refinedNotes.slice(0, 200))).join(" | ");
      const data = await generatePuzzleBatch(examType, secondaryDetails, recentLearnings);
      setPuzzleStack(data);
      setStatus('idle');
    } catch (err) {
      console.error(err);
      setStatus('failed');
    }
  };

  const puzzle = puzzleStack[currentIndex];

  const handleNext = () => {
    if (currentIndex < puzzleStack.length - 1) {
      setCurrentIndex(prev => prev + 1);
      setAnswer('');
      setIsWrong(false);
      setShowHint(false);
      setStatus('idle');
    } else {
      // Reached the end of the batch
      loadBatch();
    }
  };

  const handleCheck = async () => {
    if (!puzzle || status === 'done' || !answer.trim()) return;
    
    setIsWrong(false);
    const cleanAnswer = answer.toLowerCase().trim();
    const cleanCorrect = puzzle.answer.toLowerCase().trim();
    
    const stopWords = ['the', 'a', 'an', 'is', 'of', 'in', 'at'];
    const correctKeywords = cleanCorrect.split(' ').filter(w => !stopWords.includes(w) && w.length > 2);
    
    const isCorrect = 
      cleanAnswer === cleanCorrect || 
      (correctKeywords.length > 0 && correctKeywords.every(k => cleanAnswer.includes(k))) ||
      (cleanAnswer.length > 3 && cleanCorrect.includes(cleanAnswer));
    
    if (isCorrect) {
      setStatus('done');
      if (user) {
        await updateUserPoints(user.uid, 20); // More points for batch progression
      }
    } else {
      setIsWrong(true);
      setTimeout(() => setIsWrong(false), 1000);
    }
  };

  if (status === 'loading') {
    return (
      <Card className="bg-gradient-to-br from-indigo-700 via-indigo-600 to-violet-700 text-white border-none shadow-xl shadow-indigo-200 dark:shadow-none flex flex-col items-center justify-center min-h-[220px]">
        <Loader2 className="animate-spin mb-3 text-indigo-200" size={32} />
        <p className="text-[10px] font-black uppercase tracking-widest opacity-60">Architect is weaving 15 Challenges...</p>
      </Card>
    );
  }

  if (!puzzle) return null;

  return (
    <Card className="bg-gradient-to-br from-indigo-700 via-indigo-600 to-violet-700 text-white border-none shadow-xl shadow-indigo-200 dark:shadow-none relative overflow-hidden group min-h-[260px]">
      <div className="absolute top-0 right-0 p-4 opacity-10 -rotate-12 group-hover:rotate-0 transition-transform duration-500 hidden sm:block pointer-events-none">
         <Lightbulb size={120} />
      </div>

      <div className="relative z-10 flex flex-col h-full">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className="p-2 bg-white/20 rounded-lg text-white">
              <Sparkles size={18} />
            </div>
            <div>
              <span className="text-[10px] font-black uppercase tracking-widest text-indigo-100 block leading-none mb-1">IQ Mastery Trail</span>
              <span className="text-xs font-bold text-white leading-none">Level {currentIndex + 1} of {puzzleStack.length}</span>
            </div>
          </div>
          <button 
            onClick={loadBatch}
            className="p-1.5 hover:bg-white/10 rounded-lg transition-colors text-white/60 hover:text-white"
            title="Reset Trail"
          >
            <Clock size={14} />
          </button>
        </div>
        
        <div className="space-y-4 flex-1">
          <p className="text-base sm:text-lg font-bold leading-tight min-h-[3rem] text-indigo-50">
            {puzzle.question}
          </p>
          
          <AnimatePresence mode="wait">
            {status === 'done' ? (
              <motion.div 
                key="done"
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.95, opacity: 0 }}
                className="p-4 bg-emerald-500/20 border border-emerald-500/30 rounded-2xl flex flex-col gap-3"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-6 h-6 bg-emerald-500 rounded-full flex items-center justify-center text-[10px] font-black italic">✓</div>
                    <p className="text-xs font-black uppercase tracking-wider text-emerald-300">Level Cleared</p>
                  </div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-emerald-400">+20 Architect XP</p>
                </div>
                <p className="text-sm font-medium text-white">{puzzle.answer}</p>
                <Button 
                  onClick={handleNext}
                  className="w-full bg-emerald-500 hover:bg-emerald-600 text-white border-none shadow-lg h-10 text-xs font-black uppercase tracking-widest"
                >
                  {currentIndex === puzzleStack.length - 1 ? "Start New Trail" : "Next Challenge →"}
                </Button>
              </motion.div>
            ) : (
              <motion.div key="solving" exit={{ opacity: 0 }} className="space-y-3">
                <form 
                  onSubmit={(e) => { e.preventDefault(); handleCheck(); }}
                  className="flex gap-2"
                >
                  <div className="flex-1 relative">
                    <motion.input 
                      animate={isWrong ? { x: [-10, 10, -10, 10, 0] } : {}}
                      transition={{ duration: 0.4 }}
                      type="text" 
                      placeholder="Your deduction..."
                      className={cn(
                        "w-full bg-white/10 border rounded-xl p-3 text-sm placeholder:text-white/40 focus:bg-white/20 outline-none transition-all font-medium",
                        isWrong ? "border-rose-400 bg-rose-500/20" : "border-white/20"
                      )}
                      value={answer}
                      onChange={e => {
                        setAnswer(e.target.value);
                        if (isWrong) setIsWrong(false);
                      }}
                    />
                    {isWrong && (
                      <motion.p 
                        initial={{ opacity: 0, y: -5 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="absolute -top-6 left-0 text-[10px] font-black uppercase text-rose-300 tracking-widest"
                      >
                        Logical Error. Try again.
                      </motion.p>
                    )}
                  </div>
                  <Button 
                    type="submit"
                    className={cn(
                      "h-12 px-5 bg-white text-indigo-600 hover:bg-slate-900 hover:text-white border-none shadow-lg transition-all shrink-0 font-bold",
                      isWrong && "bg-rose-500 text-white"
                    )}
                  >
                    {isWrong ? "Retry" : "Solve"}
                  </Button>
                </form>

                <div className="flex items-center justify-between">
                  <button 
                    onClick={() => setShowHint(!showHint)}
                    className="text-[10px] font-black uppercase tracking-widest text-indigo-100 hover:text-white transition-colors flex items-center gap-1.5"
                  >
                    <div className="w-1.5 h-1.5 rounded-full bg-indigo-300 group-hover:bg-white" />
                    {showHint ? "Conceal Tip" : "Hint Needed?"}
                  </button>
                  <div className="flex gap-1.5">
                     <span className="px-2 py-0.5 rounded-full bg-white/10 text-[8px] font-black uppercase tracking-widest border border-white/10">{puzzle.difficulty}</span>
                     <span className="px-2 py-0.5 rounded-full bg-indigo-500/50 text-[8px] font-black uppercase tracking-widest border border-indigo-400/30 capitalize">{puzzle.topic}</span>
                  </div>
                </div>

                <AnimatePresence>
                  {showHint && (
                    <motion.div 
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="overflow-hidden"
                    >
                      <p className="p-3 bg-white/5 border border-white/10 rounded-xl text-xs text-indigo-100 italic leading-relaxed">
                        💡 {puzzle.hint}
                      </p>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </Card>
  );
};

const ManualNotesInput = ({ onProcess }: { onProcess: (text: string) => void }) => {
  const [text, setText] = useState('');
  return (
    <div className="w-full h-full bg-slate-50 dark:bg-indigo-950/20 border border-slate-100 dark:border-indigo-900 rounded-[2rem] p-6 sm:p-8 flex flex-col gap-5 group hover:border-indigo-300 transition-colors">
      <div className="flex flex-col sm:flex-row items-center gap-4 text-center sm:text-left">
        <div className="p-3 bg-indigo-50 dark:bg-indigo-900 rounded-xl text-indigo-600 dark:text-indigo-400 group-hover:scale-110 transition-transform">
          <Send size={24} />
        </div>
        <div>
          <p className="text-lg font-bold text-slate-950 dark:text-white">Direct Stream</p>
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 dark:text-indigo-500">Paste raw lecture notes</p>
        </div>
      </div>
      <textarea 
        placeholder="Paste your notes or extract here..."
        className="w-full flex-1 bg-white dark:bg-indigo-950 border border-slate-100 dark:border-indigo-800 rounded-2xl p-4 text-sm resize-none outline-none focus:ring-2 ring-indigo-500/20 dark:text-white font-medium min-h-[160px]"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <Button 
        onClick={() => { if(text.trim()) { onProcess(text); setText(''); } }}
        disabled={!text.trim()}
        className="w-full h-11 uppercase font-black tracking-[0.2em] text-[10px]"
      >
        Process Notes
      </Button>
    </div>
  );
};

const AITutorChat = ({ examType, secondaryDetails, user }: { examType: ExamType, secondaryDetails: string, user: User | null }) => {
  const [query, setQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ explanation: string; quiz: QuizQuestion[] } | null>(null);
  const [quizProgress, setQuizProgress] = useState<{ [qId: string]: { showHint: boolean; selected: number | null; isCorrect: boolean | null } }>({});

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim() || isLoading) return;
    
    setIsLoading(true);
    setError(null);
    setResult(null);
    setQuizProgress({});
    try {
      const data = await askAITutor(query, examType, secondaryDetails);
      setResult(data);
    } catch (err) {
      console.error(err);
      setError("Tutor is currently offline. Please try again in 30 seconds.");
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
        <form onSubmit={handleSearch} className="relative z-10 flex items-center gap-3 p-2 bg-white dark:bg-indigo-950 rounded-3xl shadow-xl shadow-indigo-100 dark:shadow-none border border-indigo-50 dark:border-indigo-900 transition-all focus-within:ring-2 focus-within:ring-indigo-600 focus-within:border-transparent">
          <div className="pl-4 text-indigo-500 dark:text-indigo-400">
            <Sparkles size={24} className={isLoading ? "animate-pulse text-indigo-600" : ""} />
          </div>
          <input 
            type="text" 
            placeholder={`Ask me anything about ${examType}... e.g. "Explain Quantum Entanglement"`}
            className="flex-1 h-14 bg-transparent outline-none text-black dark:text-indigo-100 font-medium placeholder:text-slate-600 dark:placeholder:text-indigo-600 text-sm sm:text-base min-w-0"
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
          <Button type="submit" disabled={isLoading} className="h-14 px-5 sm:px-10 rounded-2xl shadow-none whitespace-nowrap min-w-[56px]">
            {isLoading ? (
              <Loader2 className="animate-spin" size={20} />
            ) : (
              <>
                <span className="hidden sm:inline">Teach Me</span>
                <Send size={18} className="sm:hidden" />
              </>
            )}
          </Button>
        </form>
        <div className="absolute inset-0 bg-indigo-600 rounded-3xl blur-2xl opacity-[0.03] dark:opacity-[0.05] group-hover:opacity-[0.08] transition-opacity" />
      </div>

      <AnimatePresence>
        {error && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="mt-4 p-4 bg-rose-50 dark:bg-rose-950/20 border border-rose-100 dark:border-rose-900 rounded-2xl text-rose-600 dark:text-rose-400 text-sm font-medium flex items-center gap-2">
             <div className="w-1.5 h-1.5 bg-rose-600 dark:bg-rose-500 rounded-full animate-pulse" />
             {error}
          </motion.div>
        )}
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
                className="p-6 sm:p-8 bg-indigo-600 dark:bg-indigo-950 text-white rounded-[2rem] shadow-2xl flex flex-col md:flex-row items-center justify-between gap-6 overflow-hidden relative"
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

            <Card className="border-l-4 border-l-indigo-600 shadow-lg dark:bg-indigo-900/10">
              <div className="flex items-center gap-3 mb-6">
                <div className="p-2.5 bg-indigo-50 dark:bg-indigo-900 rounded-xl text-indigo-600 dark:text-indigo-400">
                  <Lightbulb size={22} />
                </div>
                <div>
                  <h3 className="text-xl font-bold text-slate-950 dark:text-white uppercase tracking-tight">Academic Tutor</h3>
                  <p className="text-[10px] font-black text-indigo-500 dark:text-indigo-400 uppercase tracking-widest">Feynman Method</p>
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
                          <p className="font-bold text-slate-950 dark:text-white mb-6 pt-4 leading-snug text-lg">{q.question}</p>
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
                              ? state.isCorrect 
                                ? "bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 text-emerald-900 dark:text-emerald-100" 
                                : "bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-800 text-rose-900 dark:text-rose-100"
                              : state?.selected !== null && isCorrect
                                ? "bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 text-emerald-900 dark:text-emerald-100 opacity-60"
                                : "bg-indigo-50/30 dark:bg-indigo-900/10 border-indigo-100 dark:border-indigo-900 hover:border-indigo-400 dark:hover:border-indigo-700 hover:bg-white dark:hover:bg-indigo-900/40 text-indigo-900 dark:text-indigo-100"
                          )}
                        >
                          <div className={cn(
                             "w-6 h-6 rounded-lg flex items-center justify-center text-[10px] font-black",
                             isSelected ? "bg-white dark:bg-indigo-600 text-indigo-600 dark:text-white shadow-sm" : "bg-indigo-100/50 dark:bg-indigo-900 text-indigo-400 dark:text-indigo-600"
                          )}>
                            {String.fromCharCode(65 + oIdx)}
                          </div>
                          {opt}
                        </button>
                      );
                    })}
                  </div>
                  {quizProgress[q.id]?.selected !== null && (
                    <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="mt-6 p-4 bg-indigo-100 dark:bg-indigo-900 text-indigo-900 dark:text-indigo-100 rounded-2xl text-xs font-medium leading-relaxed shadow-inner">
                      <div className="flex items-center gap-2 mb-2 text-indigo-500 dark:text-indigo-400">
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

const CollapsibleSection = ({ 
  title, 
  icon: Icon, 
  children, 
  id, 
  defaultOpen = true,
  className,
  headerClassName
}: { 
  title: string; 
  icon: any; 
  children: React.ReactNode; 
  id: string;
  defaultOpen?: boolean;
  className?: string;
  headerClassName?: string;
}) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <Card id={id} className={cn("overflow-hidden p-0", className)}>
      <button 
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          "w-full flex items-center justify-between p-6 hover:bg-slate-50 dark:hover:bg-indigo-900/20 transition-colors text-left",
          headerClassName
        )}
      >
        <div className="flex items-center gap-3">
          <div className="p-2 bg-indigo-50 dark:bg-indigo-900 rounded-lg text-indigo-600 dark:text-indigo-400">
            <Icon size={20} />
          </div>
          <h3 className="text-xl font-bold text-slate-950 dark:text-white">{title}</h3>
        </div>
        <motion.div
          animate={{ rotate: isOpen ? 180 : 0 }}
          transition={{ duration: 0.3, ease: "easeInOut" }}
          className="text-indigo-400"
        >
          <ChevronDown size={20} />
        </motion.div>
      </button>
      
      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: "easeInOut" }}
          >
            <div className="p-6 pt-0">
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </Card>
  );
};

const ProcessingOverlay = ({ processing }: { processing: ProcessingState }) => {
  const tips = [
    "The Feynman Technique recommends explaining concepts to a child.",
    "Active recall is 3x more effective than passive reading.",
    "Spaced repetition prevents the 'forgetting curve'.",
    "Mind maps help bridge the gap between isolated facts.",
    "Identifying what you DON'T know is the first step to mastery."
  ];
  const [tipIdx, setTipIdx] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setTipIdx(prev => (prev + 1) % tips.length);
    }, 4000);
    return () => clearInterval(interval);
  }, []);

  return (
    <AnimatePresence>
      {processing.isProcessing && (
        <motion.div 
          initial={{ opacity: 0 }} 
          animate={{ opacity: 1 }} 
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[200] bg-white/90 dark:bg-[#050614]/95 backdrop-blur-xl flex flex-col items-center justify-center p-6 text-center"
        >
          <div className="relative mb-12">
            <div className="absolute inset-0 bg-indigo-500/20 rounded-full blur-3xl animate-pulse" />
            <div className="relative p-8 bg-white dark:bg-indigo-950 rounded-[2.5rem] shadow-2xl border border-indigo-100 dark:border-indigo-900">
              <Loader2 className="animate-spin text-indigo-600 dark:text-indigo-400" size={64} />
            </div>
          </div>
          
          <div className="max-w-md w-full space-y-6">
            <div className="space-y-2">
              <h2 className="text-3xl font-black text-slate-950 dark:text-white uppercase tracking-tight">
                {processing.step === 'ocr' && "Decoding Knowledge..."}
                {processing.step === 'refining' && "Polishing Assets..."}
                {processing.step === 'summarizing' && "Feynman Extraction..."}
                {processing.step === 'quizzing' && "Crafting Training..."}
                {processing.step === 'mapping' && "Building Mental Map..."}
                {processing.step === 'idle' && "Initializing Architect..."}
              </h2>
              <p className="text-indigo-600 dark:text-indigo-400 font-bold text-sm uppercase tracking-widest">
                {processing.step === 'ocr' && "Step 1 of 4: Optical Recognition"}
                {processing.step === 'refining' && "Step 2 of 4: Content Cleanup"}
                {processing.step === 'summarizing' && "Step 3 of 4: Logical Reduction"}
                {processing.step === 'quizzing' && "Finalizing: Knowledge Check Preparation"}
                {processing.step === 'mapping' && "Step 4 of 4: Relational Graphing"}
              </p>
            </div>

            <div className="w-full h-3 bg-indigo-100 dark:bg-indigo-900/50 rounded-full overflow-hidden shadow-inner relative">
              <motion.div 
                className="h-full bg-gradient-to-r from-indigo-500 to-violet-500"
                initial={{ width: "0%" }}
                animate={{ 
                  width: 
                    processing.step === 'ocr' ? "25%" : 
                    processing.step === 'refining' ? "50%" : 
                    processing.step === 'summarizing' ? "75%" : "100%" 
                }}
                transition={{ duration: 1, ease: "easeOut" }}
              />
            </div>

            <AnimatePresence mode="wait">
              <motion.div
                key={tipIdx}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="p-6 bg-slate-50 dark:bg-indigo-900/20 rounded-[2rem] border border-slate-100 dark:border-indigo-800"
              >
                <p className="text-[10px] font-black uppercase text-indigo-400 dark:text-indigo-500 mb-2 tracking-[0.2em]">Architecture Tip</p>
                <p className="text-slate-700 dark:text-indigo-200 text-sm font-medium italic">"{tips[tipIdx]}"</p>
              </motion.div>
            </AnimatePresence>

            <p className="text-slate-500 text-xs font-medium">Please stay on this page. Our Academic Architect is weaving your study ecosystem.</p>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default function App() {
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('theme');
      if (saved === 'light' || saved === 'dark') return saved;
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    return 'light';
  });

  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<any>(null);
  const [examType, setExamType] = useState<ExamType>('General');
  const [secondaryDetails, setSecondaryDetails] = useState('');
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [sessions, setSessions] = useState<StudySession[]>([]);
  const [reminders, setReminders] = useState<StudyReminder[]>([]);
  const [currentSession, setCurrentSession] = useState<StudySession | null>(null);
  const [processing, setProcessing] = useState<ProcessingState>({ isProcessing: false, step: 'idle' });
  const [error, setError] = useState<string | null>(null);
  const [quizProgress, setQuizProgress] = useState<{ [qId: string]: { showHint: boolean; selected: number | null; isCorrect: boolean | null } }>({});
  const [showRemindersModal, setShowRemindersModal] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [showTrackModal, setShowTrackModal] = useState(false);
  const [newReminder, setNewReminder] = useState({ topic: '', time: '', date: '' });
  const [isInitializing, setIsInitializing] = useState(true);

  // Theme Effect
  useEffect(() => {
    const root = window.document.documentElement;
    const body = window.document.body;
    if (theme === 'dark') {
      root.classList.add('dark');
      body.classList.add('dark');
    } else {
      root.classList.remove('dark');
      body.classList.remove('dark');
    }
    try {
      localStorage.setItem('theme', theme);
    } catch (e) {
      console.warn('Failed to save theme to localStorage:', e);
    }
  }, [theme]);

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
              new Notification("Prodigy Alert!", {
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

  const handleYoutubeProcess = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!youtubeUrl.trim() || !youtubeUrl.includes('youtube.com') && !youtubeUrl.includes('youtu.be')) {
      setError("Please enter a valid YouTube URL");
      return;
    }

    setProcessing({ isProcessing: true, step: 'ocr' });
    try {
      const result = await processYouTubeVideo(youtubeUrl, examType, secondaryDetails);
      
      const sessionData: StudySession = {
        id: Math.random().toString(36).substr(2, 9),
        title: result.title,
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
      setYoutubeUrl('');
      
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
    } catch (err) {
      console.error(err);
      setProcessing({ isProcessing: false, step: 'idle', error: 'YouTube extraction failed.' });
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
    <div className={cn(
      "min-h-screen font-sans selection:bg-indigo-100 transition-colors duration-300",
      theme === 'dark' ? "dark" : ""
    )}>
      {/* --- Navigation Bar --- */}
      <nav className="bg-white/80 dark:bg-indigo-950/80 backdrop-blur-md border-b border-indigo-100 dark:border-indigo-900 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="bg-indigo-600 dark:bg-indigo-500 p-2 rounded-xl text-white">
              <GraduationCap size={24} />
            </div>
            <span className="text-xl font-bold tracking-tight text-slate-950 dark:text-white">Prodigy</span>
          </div>
          
          <div className="flex items-center gap-2 sm:gap-4">
            <ThemeToggle theme={theme} toggle={() => setTheme(theme === 'light' ? 'dark' : 'light')} />

            {/* Reminders / Alert System */}
            <button 
              onClick={() => setShowRemindersModal(true)}
              className="flex items-center gap-3 px-3 sm:px-5 py-2.5 bg-indigo-50 dark:bg-indigo-950 hover:bg-slate-200 dark:hover:bg-indigo-900 border border-indigo-100 dark:border-indigo-900 rounded-2xl transition-all group relative hover:scale-105"
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
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-950 dark:text-indigo-400 group-hover:text-indigo-300 leading-none mb-0.5">Study Focus</p>
                <p className="text-sm font-bold leading-tight text-slate-950 dark:text-white">Reminders</p>
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
            className="mb-6 p-4 bg-indigo-900 dark:bg-indigo-950/60 border border-indigo-800 dark:border-indigo-900 rounded-2xl flex flex-col sm:flex-row items-center justify-between gap-4 shadow-lg shadow-indigo-100 dark:shadow-none"
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
            <div className="flex flex-col sm:flex-row items-center justify-between gap-6 mb-12">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-indigo-600 dark:bg-indigo-500 rounded-2xl text-white shadow-lg shadow-indigo-200 dark:shadow-none">
                  <Sparkles size={24} />
                </div>
                <div className="text-left">
                  <h2 className="text-2xl font-bold text-slate-950 dark:text-white">Academic Level {Math.floor((profile?.points || 0) / 100) + 1}</h2>
                  <p className="text-indigo-500 dark:text-indigo-300 text-sm font-medium">You have {profile?.points || 0} Architect Points</p>
                </div>
              </div>
              
              <div className="flex gap-2">
                <div className="px-4 py-2 bg-white dark:bg-indigo-900/40 border border-indigo-100 dark:border-indigo-800 rounded-xl shadow-sm text-center min-w-[100px]">
                  <p className="text-[10px] font-black uppercase text-indigo-400 dark:text-indigo-300">Daily Streak</p>
                  <p className="text-lg font-black text-slate-950 dark:text-indigo-400">{profile?.dailyStreak || 0} 🔥</p>
                </div>
                <div className="px-4 py-2 bg-indigo-600 dark:bg-indigo-900 text-white rounded-xl shadow-sm text-center min-w-[100px]">
                  <p className="text-[10px] font-black uppercase text-indigo-100 dark:text-indigo-200">Rank</p>
                  <p className="text-lg font-black text-white">{profile?.points > 500 ? 'Pro' : 'Elite'}</p>
                </div>
              </div>
            </div>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-6"
            >
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-indigo-100 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300 text-sm font-semibold mb-4">
                <Sparkles size={16} />
                <span>Your AI Academic Architect</span>
              </div>
              <h1 className="text-4xl sm:text-5xl md:text-6xl font-extrabold text-slate-950 dark:text-white leading-tight">
                Transform messy notes into <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-600 to-violet-600 dark:from-indigo-400 dark:to-violet-400">mastery.</span>
              </h1>
              <p className="text-lg text-slate-950 dark:text-indigo-200/80 leading-relaxed font-medium">
                Deep-learn through three neural streams. We handle OCR for images, summarize YouTube lectures, and extract logic from your text using the Feynman Technique.
              </p>

              <div className="mt-12 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 items-stretch">
                {/* Visual Stream */}
                <div className="space-y-3 flex flex-col">
                  <p className="text-[10px] font-black uppercase text-indigo-400 dark:text-indigo-500 tracking-[0.25em] text-center">Neural I: Vision</p>
                  <div 
                    {...getRootProps()} 
                    className={cn(
                      "flex-1 rounded-[2rem] border-2 border-dashed flex flex-col items-center justify-center gap-5 p-8 cursor-pointer transition-all group relative",
                      isDragActive 
                        ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-900/50 scale-[1.02]" 
                        : "border-slate-100 dark:border-indigo-900 bg-white dark:bg-indigo-950/20 hover:border-indigo-300 dark:hover:border-indigo-700"
                    )}
                  >
                    <input {...getInputProps()} />
                    <div className="p-4 bg-indigo-50 dark:bg-indigo-900 rounded-2xl text-indigo-600 dark:text-indigo-400 group-hover:scale-110 transition-transform">
                      <Upload size={32} />
                    </div>
                    <div className="space-y-1">
                      <p className="text-lg font-bold text-slate-950 dark:text-white">Snap & Solve</p>
                      <p className="text-xs font-medium text-slate-500 dark:text-indigo-400">PDF, images, handwriting</p>
                    </div>
                  </div>
                </div>

                {/* Video Stream */}
                <div className="space-y-3 flex flex-col">
                  <p className="text-[10px] font-black uppercase text-rose-400 dark:text-rose-500 tracking-[0.25em] text-center">Neural II: Lecture</p>
                  <div className="flex-1 rounded-[2rem] bg-indigo-50/30 dark:bg-indigo-950/20 border border-slate-100 dark:border-indigo-900 p-8 flex flex-col items-center justify-center gap-5 group hover:border-rose-400 transition-colors">
                    <div className="p-4 bg-rose-50 dark:bg-rose-950/30 rounded-2xl text-rose-600 dark:text-rose-400 group-hover:scale-110 transition-transform">
                      <Youtube size={32} />
                    </div>
                    <div className="w-full space-y-4">
                      <div className="space-y-1 text-center">
                        <p className="text-lg font-bold text-slate-950 dark:text-white">YouTube Sync</p>
                        <p className="text-xs font-medium text-slate-500 dark:text-rose-400">Summarize & Quiz lectures</p>
                      </div>
                      <form onSubmit={handleYoutubeProcess} className="space-y-3">
                        <input 
                          type="text" 
                          placeholder="Paste link..."
                          className="w-full h-11 bg-white dark:bg-indigo-900 border border-slate-100 dark:border-indigo-800 rounded-xl px-4 text-xs font-medium outline-none focus:ring-2 ring-rose-500/20 dark:text-white"
                          value={youtubeUrl}
                          onChange={(e) => setYoutubeUrl(e.target.value)}
                        />
                        <Button type="submit" className="w-full bg-rose-600 hover:bg-rose-700 text-white border-none h-11 text-[10px] font-black uppercase tracking-[0.2em]">
                          Analyze Video
                        </Button>
                      </form>
                    </div>
                  </div>
                </div>

                {/* Thought Stream */}
                <div className="space-y-3 flex flex-col">
                  <p className="text-[10px] font-black uppercase text-indigo-400 dark:text-indigo-500 tracking-[0.25em] text-center">Neural III: Thought</p>
                  <div className="flex-1">
                    <ManualNotesInput onProcess={async (text) => {
                      setProcessing({ isProcessing: true, step: 'summarizing' });
                      try {
                        const result = await processStudyMaterial(text, examType, secondaryDetails);
                        const sessionData: StudySession = {
                          id: Math.random().toString(36).substr(2, 9),
                          title: result.title || "Manual Notes",
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
                        setProcessing({ isProcessing: false, step: 'idle', error: 'Failed to process notes.' });
                      }
                    }} />
                  </div>
                </div>
              </div>

              <div className="mt-16 w-full grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 text-left border-t border-slate-100 dark:border-indigo-900 pt-16">
                {/* 1. Daily Puzzle */}
                <DailyPuzzle examType={examType} secondaryDetails={secondaryDetails} user={user} sessions={sessions} />

                {/* 2. Recent Sessions */}
                <div className="space-y-4">
                  <h3 className="text-lg font-bold flex items-center gap-2 text-indigo-950 dark:text-indigo-100">
                    <BookOpen size={20} className="text-indigo-600 dark:text-indigo-400" />
                    Recent Sessions
                  </h3>
                  <div className="grid grid-cols-1 gap-4">
                    {sessions.length > 0 ? sessions.slice(0, 2).map(s => (
                      <button
                        key={s.id}
                        onClick={() => setCurrentSession(s)}
                        className="flex items-center gap-4 p-4 bg-white dark:bg-indigo-950/40 rounded-2xl border border-indigo-50 dark:border-indigo-900 hover:border-indigo-200 dark:hover:border-indigo-700 transition-all text-left shadow-sm group"
                      >
                        <div className="p-2 bg-indigo-50 dark:bg-indigo-900 rounded-lg text-indigo-600 dark:text-indigo-400 group-hover:bg-indigo-600 dark:group-hover:bg-indigo-500 group-hover:text-white transition-colors">
                          <ClipboardList size={20} />
                        </div>
                        <div className="min-w-0">
                          <p className="font-bold text-black dark:text-indigo-100 truncate">{s.title}</p>
                          <p className="text-[10px] text-slate-700 dark:text-indigo-500 font-bold uppercase tracking-widest">{new Date(s.timestamp).toLocaleDateString()}</p>
                        </div>
                        <ChevronRight className="ml-auto text-indigo-200 dark:text-indigo-800 group-hover:text-indigo-500 dark:group-hover:text-indigo-400 transition-colors shrink-0" size={20} />
                      </button>
                    )) : (
                      <div className="p-8 border-2 border-dashed border-indigo-50 dark:border-indigo-900 rounded-2xl text-center">
                        <p className="text-sm text-indigo-400 dark:text-indigo-500 font-medium italic">No sessions yet...</p>
                      </div>
                    )}
                  </div>
                </div>

                {/* 3. Study Alerts Box */}
                <div className="space-y-4">
                  <h3 className="text-lg font-bold flex items-center gap-2 text-indigo-950 dark:text-indigo-100">
                    <Bell size={20} className="text-indigo-600 dark:text-indigo-400" />
                    Focus Alerts
                  </h3>
                  <div 
                    onClick={() => setShowRemindersModal(true)}
                    className="p-6 bg-indigo-600 dark:bg-indigo-950 rounded-3xl text-white shadow-xl cursor-pointer hover:scale-[1.02] transition-all group relative overflow-hidden"
                  >
                    <div className="absolute top-0 right-0 p-8 opacity-10 dark:opacity-20 group-hover:scale-125 transition-transform duration-500">
                      <Clock size={80} />
                    </div>
                    <div className="relative z-10 space-y-4">
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-1 bg-indigo-600 dark:bg-indigo-900/50 rounded text-[10px] font-black uppercase tracking-widest">Active Schedule</span>
                        <div className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse" />
                      </div>
                      
                      {reminders.filter(r => !r.isCompleted).length > 0 ? (
                        <div>
                          <p className="text-2xl font-black leading-tight truncate">
                            {reminders.filter(r => !r.isCompleted)[0].topic}
                          </p>
                          <p className="text-indigo-300 dark:text-indigo-100 text-sm font-bold flex items-center gap-2 mt-1">
                            <Clock size={14} />
                            {new Date(reminders.filter(r => !r.isCompleted)[0].time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </p>
                        </div>
                      ) : (
                        <div>
                          <p className="text-xl font-bold opacity-60 dark:opacity-80">No pending alerts</p>
                          <p className="text-sm opacity-40 dark:opacity-60">Plan your next study marathon</p>
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
                    className="flex items-center gap-3 p-3 rounded-lg hover:bg-indigo-50 dark:hover:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300 hover:text-indigo-900 dark:hover:text-white transition-colors font-medium text-sm"
                   >
                     <item.icon size={18} />
                     {item.label}
                   </a>
                ))}
              </div>

              <div className="p-4 bg-indigo-600 dark:bg-indigo-900 rounded-2xl text-white space-y-4">
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
                  <h1 className="text-3xl font-black text-black dark:text-white uppercase tracking-tight truncate">{currentSession.title}</h1>
                  <div className="inline-flex items-center bg-indigo-100 dark:bg-indigo-900/50 px-3 py-1 rounded-lg text-indigo-700 dark:text-indigo-400 text-[10px] font-black ring-1 ring-indigo-200 dark:ring-indigo-800 uppercase mt-1">
                    {currentSession.examType} Focus
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button 
                    onClick={() => exportToMarkdown(currentSession)}
                    variant="secondary"
                    className="shrink-0 h-11 px-4 shadow-sm border-indigo-100 dark:border-indigo-900"
                  >
                    <Download size={18} />
                    <span className="hidden sm:inline">MD</span>
                  </Button>
                  <Button 
                    onClick={() => window.print()}
                    variant="secondary"
                    className="shrink-0 h-11 px-4 shadow-sm border-indigo-100 dark:border-indigo-900"
                  >
                    <FileText size={18} />
                    <span className="hidden sm:inline">PDF</span>
                  </Button>
                </div>
              </div>

              {/* 1. Refined Notes */}
              <CollapsibleSection 
                id="refined"
                title="OCR & Refined Notes" 
                icon={ClipboardList}
              >
                <Markdown content={currentSession.refinedNotes || ''} />
              </CollapsibleSection>

              {/* 2. Feynman Summary & Deep Dive */}
              <CollapsibleSection 
                id="summaries"
                title="Analytical Insights" 
                icon={Lightbulb}
                className="border-l-4 border-l-amber-400"
              >
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8 pt-4">
                  <div id="feynman" className="p-6 bg-amber-50/50 dark:bg-amber-950/10 rounded-2xl border border-amber-100 dark:border-amber-900/50">
                    <p className="text-xs text-amber-600 dark:text-amber-500 font-bold mb-4 uppercase tracking-widest">The Feynman Bridge</p>
                    <div className="text-slate-950 dark:text-indigo-100 italic leading-relaxed">
                      <Markdown content={currentSession.summary?.feynman || ''} />
                    </div>
                  </div>

                  <div id="deep-dive" className="p-6 bg-indigo-600 dark:bg-indigo-900 rounded-2xl text-indigo-50 shadow-xl">
                    <div className="flex items-center gap-2 mb-4">
                      <BookOpen size={18} className="text-indigo-300" />
                      <p className="text-xs text-indigo-300 font-bold uppercase tracking-widest">Deep Dive</p>
                    </div>
                    <div className="text-indigo-50 text-sm leading-relaxed">
                      <Markdown content={currentSession.summary?.deepDive || ''} />
                    </div>
                  </div>
                </div>
              </CollapsibleSection>

              {/* 3. Visual Map */}
              <CollapsibleSection 
                id="visual-map"
                title="Mental Architecture" 
                icon={MapIcon}
              >
                <div className="bg-emerald-50/30 dark:bg-emerald-950/20 p-6 rounded-xl border border-emerald-100 dark:border-emerald-900/50 mt-2">
                  <Markdown content={currentSession.visualMap || ''} />
                </div>
              </CollapsibleSection>

              {/* 4. Smart Quiz */}
              <CollapsibleSection 
                id="quiz" 
                title="Smart Knowledge Check"
                icon={Sparkles}
                className="border-2 border-indigo-600 dark:border-indigo-500 overflow-visible"
                headerClassName="bg-indigo-50/50 dark:bg-indigo-900/20"
              >
                <div className="mt-4">
                  {!currentSession.quiz ? (
                    <div className="py-12 flex flex-col items-center gap-4">
                      <Loader2 className="animate-spin text-indigo-600 dark:text-indigo-400" size={32} />
                      <p className="text-indigo-500 dark:text-indigo-400 font-medium tracking-wide">Synthesizing analytical questions...</p>
                    </div>
                  ) : (
                    <div className="space-y-12 pb-6">
                      {currentSession.quiz.map((q, idx) => (
                      <div key={q.id} className="space-y-6">
                        <div className="flex items-start gap-4">
                          <span className="text-4xl font-black text-slate-200 dark:text-indigo-900 shrink-0">0{idx + 1}</span>
                          <p className="text-xl font-bold text-black dark:text-white pt-2 leading-snug">{q.question}</p>
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
                                       ? "bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 text-emerald-900 dark:text-emerald-100" 
                                       : "bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-800 text-rose-900 dark:text-rose-100"
                                     : state?.selected !== null && isCorrect
                                       ? "bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 text-emerald-900 dark:text-emerald-100 opacity-60"
                                       : "bg-indigo-50/30 dark:bg-indigo-900/10 border-indigo-100 dark:border-indigo-900 hover:border-indigo-300 dark:hover:border-indigo-700 text-indigo-900 dark:text-indigo-100"
                                 )}
                               >
                                 <div className={cn(
                                   "w-6 h-6 rounded-full border-2 flex items-center justify-center text-xs font-bold shrink-0",
                                   isSelected
                                    ? state.isCorrect ? "border-emerald-500 bg-emerald-500 dark:border-emerald-400 dark:bg-emerald-400 text-white" : "border-rose-500 bg-rose-500 dark:border-rose-400 dark:bg-rose-400 text-white"
                                    : "border-indigo-200 dark:border-indigo-800 text-indigo-300 dark:text-indigo-700 group-hover:border-indigo-400 dark:group-hover:border-indigo-600"
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
                            className="text-xs font-black uppercase tracking-widest text-indigo-400 dark:text-indigo-600 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors flex items-center gap-1"
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
                               <div className="bg-amber-50 dark:bg-amber-950/20 p-4 rounded-xl border border-amber-100 dark:border-amber-900 text-sm text-amber-900 dark:text-amber-400 italic">
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
                              quizProgress[q.id].isCorrect 
                                ? "bg-emerald-50 dark:bg-emerald-950/20 border-emerald-100 dark:border-emerald-900 text-emerald-900 dark:text-emerald-400" 
                                : "bg-rose-50 dark:bg-rose-950/20 border-rose-100 dark:border-rose-900 text-rose-900 dark:text-rose-400"
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
                </div>
              </CollapsibleSection>
            </div>
          </div>
        )}
      </main>

      <ProcessingOverlay processing={processing} />

      <AnimatePresence>
        {(error || processing.error) && (
          <motion.div 
            initial={{ opacity: 0, y: 20, x: "-50%" }} 
            animate={{ opacity: 1, y: 0, x: "-50%" }} 
            exit={{ opacity: 0, scale: 0.95, x: "-50%" }}
            className="fixed bottom-8 left-1/2 z-[200] w-full max-w-md px-4"
          >
            <div className="bg-rose-600 text-white p-5 rounded-[2rem] shadow-2xl flex items-center justify-between gap-4 border-2 border-rose-500/50 backdrop-blur-lg">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-white/20 rounded-2xl">
                  <Activity size={24} className="text-white" />
                </div>
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest opacity-80 mb-0.5">System Alert</p>
                  <p className="text-sm font-bold leading-tight">{error || processing.error}</p>
                </div>
              </div>
              <button 
                onClick={() => { setError(null); setProcessing(p => ({ ...p, error: undefined })); }} 
                className="p-2 hover:bg-white/10 rounded-xl transition-colors"
                title="Dismiss"
              >
                <X size={20} />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Footer Meta */}
      <footer className="border-t border-indigo-100 dark:border-indigo-900 py-12 bg-white dark:bg-indigo-950/20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col md:flex-row justify-between items-center gap-8">
          <div className="flex items-center gap-2">
            <div className="bg-indigo-600 dark:bg-indigo-500 p-1.5 rounded-lg text-white">
              <GraduationCap size={16} />
            </div>
            <span className="text-sm font-bold tracking-tight text-indigo-900 dark:text-white">Prodigy</span>
          </div>
          <div className="text-center md:text-left">
            <p className="text-xs text-slate-950 dark:text-indigo-400 font-medium">Built for the future of academic excellence. Powered by Prodigy Intelligence.</p>
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-900 dark:text-indigo-500 mt-1">this app is made by VISHAL DHULE</p>
          </div>
          <div className="flex gap-6 text-xs font-black uppercase tracking-widest text-slate-950 dark:text-indigo-500">
             <a href="#" className="hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors">UPSC Guide</a>
             <a href="#" className="hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors">JEE Mastery</a>
             <a href="#" className="hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors">BCA Logic</a>
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
              className="relative bg-white dark:bg-indigo-950 w-full max-w-md rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[95vh] border dark:border-indigo-800"
            >
              <div className="p-6 sm:p-8 overflow-y-auto custom-scrollbar">
              <div className="flex items-center justify-between mb-8">
                <div>
                  <h2 className="text-2xl font-black text-slate-950 dark:text-white uppercase tracking-tight">Study Alerts</h2>
                  <p className="text-slate-600 dark:text-indigo-400 text-sm font-medium">Schedule your next mastery session</p>
                </div>
                <button 
                  onClick={() => setShowRemindersModal(false)}
                  className="p-2 hover:bg-indigo-50 dark:hover:bg-indigo-900 rounded-full text-indigo-300 dark:text-indigo-700 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
                >
                  <X size={24} />
                </button>
              </div>

              <form onSubmit={addReminder} className="space-y-4 mb-8">
                <div className="space-y-1">
                  <label className="text-xs font-black text-slate-950 dark:text-indigo-400 uppercase tracking-widest px-1">Study Topic</label>
                  <input 
                    type="text" 
                    required
                    placeholder="e.g. Modern Physics (JEE)"
                    className="w-full bg-slate-100 dark:bg-indigo-900/50 border-none rounded-xl p-3 text-slate-950 dark:text-white placeholder:text-slate-500 dark:placeholder:text-indigo-700 focus:ring-2 focus:ring-indigo-600"
                    value={newReminder.topic}
                    onChange={e => setNewReminder({...newReminder, topic: e.target.value})}
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-xs font-black text-slate-950 dark:text-indigo-400 uppercase tracking-widest px-1">Date</label>
                    <input 
                      type="date" 
                      required
                      className="w-full bg-slate-100 dark:bg-indigo-900/50 border-none rounded-xl p-3 text-slate-950 dark:text-white focus:ring-2 focus:ring-indigo-600 transition-all [color-scheme:light] dark:[color-scheme:dark]"
                      value={newReminder.date}
                      onChange={e => setNewReminder({...newReminder, date: e.target.value})}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-black text-slate-950 dark:text-indigo-400 uppercase tracking-widest px-1">Time</label>
                    <input 
                      type="time" 
                      required
                      className="w-full bg-slate-100 dark:bg-indigo-900/50 border-none rounded-xl p-3 text-slate-950 dark:text-white focus:ring-2 focus:ring-indigo-600 transition-all [color-scheme:light] dark:[color-scheme:dark]"
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
                  <h3 className="text-xs font-black text-slate-950 dark:text-indigo-400 uppercase tracking-widest px-1">Upcoming Alerts</h3>
                {reminders.length === 0 ? (
                  <div className="text-center py-8 bg-indigo-50/50 dark:bg-indigo-900/20 rounded-2xl border-2 border-dashed border-indigo-100 dark:border-indigo-900">
                    <p className="text-indigo-400 dark:text-indigo-600 text-sm font-medium">No active alerts scheduled.</p>
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
                        <p className={cn("font-bold text-slate-950 dark:text-indigo-100 truncate", r.isCompleted && "line-through")}>{r.topic}</p>
                        <p className="text-[10px] uppercase font-black tracking-widest text-slate-950 dark:text-indigo-400">
                          {new Date(r.time).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
                        </p>
                      </div>
                      <button 
                        onClick={() => deleteReminder(r.id)}
                        className="p-3 text-indigo-400 dark:text-indigo-600 hover:text-rose-500 transition-colors hover:bg-rose-50 rounded-xl"
                      >
                        <Trash2 size={18} />
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
              className="relative bg-white dark:bg-indigo-950 w-full max-w-sm rounded-[2rem] shadow-2xl overflow-hidden flex flex-col max-h-[90vh] border dark:border-indigo-800"
            >
              <div className="p-8 text-center space-y-6 overflow-y-auto custom-scrollbar">
                {!user ? (
                  <>
                    <div className="mx-auto w-16 h-16 bg-indigo-100 dark:bg-indigo-900 rounded-2xl flex items-center justify-center text-indigo-600 dark:text-indigo-400">
                      <GraduationCap size={32} />
                    </div>
                    <div>
                      <h2 className="text-2xl font-black text-slate-950 dark:text-white uppercase tracking-tight">Academic Profile</h2>
                      <p className="text-slate-950 dark:text-indigo-400 text-sm font-medium">Continue your journey to mastery</p>
                    </div>
                    <Button onClick={() => { signInWithGoogle(); setShowAuthModal(false); }} className="w-full h-12">
                      <img src="https://www.google.com/favicon.ico" className="w-5 h-5 mr-1" alt="Google" />
                      Sign in with Google
                    </Button>
                  </>
                ) : (
                  <>
                    <div className="relative mx-auto w-24 h-24">
                      {user.photoURL && <img src={user.photoURL} alt="Profile" className="w-full h-full rounded-3xl object-cover shadow-lg border-2 border-white dark:border-indigo-900" referrerPolicy="no-referrer" />}
                      <div className="absolute -bottom-2 -right-2 bg-emerald-500 text-white p-2 rounded-xl shadow-lg">
                        <Sparkles size={16} />
                      </div>
                    </div>
                    <div>
                      <h2 className="text-xl font-black text-indigo-900 dark:text-white truncate">{user.displayName}</h2>
                      <p className="text-[10px] font-black text-indigo-400 dark:text-indigo-500 uppercase tracking-widest mb-4">Current Track: {profile?.examType || examType}</p>
                    </div>

                    <div className="space-y-4 text-left">
                      <div className="space-y-1">
                        <label className="text-[10px] font-black text-slate-950 dark:text-indigo-400 uppercase px-2 tracking-widest">Secondary Details</label>
                        <input 
                          type="text"
                          placeholder="e.g. 2026 Batch, Neuro Surgery, etc."
                          className="w-full bg-slate-100 dark:bg-indigo-900/50 border-none rounded-xl p-3 text-sm text-slate-950 dark:text-white placeholder:text-slate-500 dark:placeholder:text-indigo-700 focus:ring-2 focus:ring-indigo-600 transition-all font-medium"
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
                        <p className="text-[10px] font-black text-slate-950 dark:text-indigo-400 uppercase px-2 tracking-widest">Select Academic Track</p>
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
                                : "bg-indigo-50 dark:bg-indigo-900/30 text-indigo-900 dark:text-indigo-100 border-indigo-100 dark:border-indigo-800 hover:border-indigo-300 dark:hover:border-indigo-600"
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
                      <div className="p-3 bg-indigo-50 dark:bg-indigo-900/50 rounded-2xl">
                        <p className="text-[10px] font-black text-indigo-400 dark:text-indigo-600 uppercase">Streak</p>
                        <p className="text-lg font-black text-indigo-900 dark:text-white">{profile?.dailyStreak || 0} Days</p>
                      </div>
                      <div className="p-3 bg-indigo-50 dark:bg-indigo-900/50 rounded-2xl">
                        <p className="text-[10px] font-black text-indigo-400 dark:text-indigo-600 uppercase">Points</p>
                        <p className="text-lg font-black text-indigo-900 dark:text-white">{profile?.points || 0}</p>
                      </div>
                    </div>

                    <Button variant="outline" onClick={() => { logout(); setShowAuthModal(false); }} className="w-full border-rose-100 dark:border-rose-900 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/20 hover:border-rose-200">
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
              className="relative bg-white dark:bg-indigo-950 w-full max-w-2xl rounded-[3rem] shadow-2xl overflow-hidden flex flex-col max-h-[90vh] border dark:border-indigo-800"
            >
              <div className="p-6 sm:p-10 text-center space-y-8 overflow-y-auto custom-scrollbar">
                <div className="mx-auto w-20 h-20 bg-indigo-600 dark:bg-indigo-500 text-white rounded-[2rem] flex items-center justify-center shadow-xl shadow-indigo-200 dark:shadow-none">
                  <Sparkles size={40} />
                </div>
                
                <div className="flex items-center gap-2 mb-4">
                  <div className="p-2 bg-indigo-600 dark:bg-indigo-500 rounded-xl text-white">
                    <GraduationCap size={32} />
                  </div>
                  <div>
                    <h2 className="text-3xl font-black text-slate-950 dark:text-white leading-tight">CHOOSE YOUR MISSION</h2>
                    <p className="text-slate-950 dark:text-indigo-300 font-medium max-w-sm mx-auto">To customize your learning intelligence, please select your primary academic track.</p>
                  </div>
                </div>

                <div className="space-y-6">
                  <div className="space-y-2 text-left max-w-md mx-auto">
                    <label className="text-[10px] font-black text-slate-950 dark:text-indigo-400 uppercase px-2 tracking-widest">Secondary Details (Optional)</label>
                    <input 
                      type="text" 
                      placeholder="e.g. Target Exam Year, Specific Subjects, Focus Areas"
                      className="w-full bg-slate-100 dark:bg-indigo-900/50 border-2 border-transparent rounded-[1.5rem] p-4 text-slate-950 dark:text-white placeholder:text-slate-500 dark:placeholder:text-indigo-700 focus:ring-2 focus:ring-indigo-600 focus:bg-white dark:focus:bg-indigo-900 transition-all font-medium"
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
                        className="group flex items-center gap-4 p-5 bg-indigo-50 dark:bg-indigo-900/50 hover:bg-indigo-600 dark:hover:bg-indigo-500 transition-all rounded-[2rem] text-left border border-indigo-100 dark:border-indigo-800 hover:border-transparent"
                      >
                        <div className={cn("p-3 rounded-2xl text-white shadow-lg transition-transform group-hover:scale-110", track.color)}>
                          <track.icon size={24} />
                        </div>
                        <div>
                          <p className="text-sm font-black text-indigo-900 dark:text-white group-hover:text-white transition-colors">{track.label}</p>
                          <p className="text-[10px] font-bold text-indigo-400 dark:text-indigo-300 group-hover:text-indigo-200 dark:group-hover:text-indigo-100 uppercase tracking-widest transition-colors">{track.id} Track</p>
                        </div>
                        <ChevronRight className="ml-auto text-indigo-200 dark:text-indigo-800 group-hover:text-white transition-colors" size={20} />
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
