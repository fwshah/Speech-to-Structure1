import { useState, useRef } from 'react';
import { GoogleGenAI, Type } from "@google/genai";
import { 
  FileAudio, 
  Upload, 
  Download, 
  Loader2, 
  CheckCircle2, 
  AlertCircle,
  Play,
  Pause,
  Trash2
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import ReactMarkdown from 'react-markdown';
import { cn, formatTimestamp, fileToBase64 } from '@/src/lib/utils';
import { TranscriptionReport } from '@/src/types';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export default function App() {
  const [file, setFile] = useState<File | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingStage, setProcessingStage] = useState<'idle' | 'encoding' | 'analyzing'>('idle');
  const [report, setReport] = useState<TranscriptionReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      if (!selectedFile.type.startsWith('audio/') && !selectedFile.name.toLowerCase().endsWith('.mp3') && !selectedFile.name.toLowerCase().endsWith('.wav')) {
        setError('Please upload a valid audio file (MP3, WAV, etc.)');
        return;
      }
      
      if (selectedFile.size > 25 * 1024 * 1024) {
        setError('File is too large. Please upload an audio file under 25MB for better performance.');
        return;
      }

      setFile(selectedFile);
      setAudioUrl(URL.createObjectURL(selectedFile));
      setError(null);
      setReport(null);
    }
  };

  const processAudio = async () => {
    if (!file) return;

    setIsProcessing(true);
    setProcessingStage('encoding');
    setError(null);

    try {
      console.log('Starting audio processing for:', file.name);
      const base64Audio = await fileToBase64(file);
      
      setProcessingStage('analyzing');
      console.log('File encoded, sending to Gemini...');

      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [
          {
            parts: [
              {
                inlineData: {
                  mimeType: file.type || 'audio/mpeg',
                  data: base64Audio
                }
              },
              {
                text: `You are an expert transcriptionist. Transcribe this audio file with professional speaker diarization and sentence-level timestamps. 
                
                Guidelines:
                - Identify speakers as 'Speaker 1', 'Speaker 2', etc. Use context to identify names if possible.
                - Provide a clear, professional title for the recording.
                - Provide a concise summary of the key points discussed.
                - Ensure timestamps are accurate in seconds.
                
                Respond ONLY with a JSON object:
                { 
                  "title": string, 
                  "summary": string, 
                  "segments": [ 
                    { "speaker": string, "text": string, "startTime": number, "endTime": number } 
                  ], 
                  "speakers": string[] 
                }`
              }
            ]
          }
        ],
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              title: { type: Type.STRING },
              summary: { type: Type.STRING },
              segments: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    speaker: { type: Type.STRING },
                    text: { type: Type.STRING },
                    startTime: { type: Type.NUMBER },
                    endTime: { type: Type.NUMBER }
                  },
                  required: ["speaker", "text", "startTime", "endTime"]
                }
              },
              speakers: {
                type: Type.ARRAY,
                items: { type: Type.STRING }
              }
            },
            required: ["title", "summary", "segments", "speakers"]
          }
        }
      });

      const resultText = response.text;
      console.log('Received response from Gemini');
      
      if (!resultText) {
        throw new Error("Gemini returned an empty response. This can happen if the audio content is too short or unsupported.");
      }
      
      try {
        // Find the first { and last } to handle cases where the model might wrap in markdown
        const jsonStart = resultText.indexOf('{');
        const jsonEnd = resultText.lastIndexOf('}');
        const cleanJson = resultText.substring(jsonStart, jsonEnd + 1);
        
        const parsedReport: TranscriptionReport = JSON.parse(cleanJson);
        setReport(parsedReport);
      } catch (parseError) {
        console.error('JSON Parse Error:', resultText);
        throw new Error("Failed to parse the transcription data. Please try again.");
      }
    } catch (err: any) {
      console.error('Processing Error:', err);
      setError(err.message || 'An unexpected error occurred during transcription.');
    } finally {
      setIsProcessing(false);
      setProcessingStage('idle');
    }
  };

  const downloadReport = () => {
    if (!report) return;

    const content = `
# ${report.title}

## Summary
${report.summary}

## Transcription
${report.segments.map(s => `[${formatTimestamp(s.startTime)}] ${s.speaker}: ${s.text}`).join('\n\n')}
    `.trim();

    const blob = new Blob([content], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${report.title.toLowerCase().replace(/\s+/g, '-')}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const togglePlay = () => {
    if (audioRef.current) {
      if (isPlaying) {
        audioRef.current.pause();
      } else {
        audioRef.current.play();
      }
      setIsPlaying(!isPlaying);
    }
  };

  const jumpTo = (time: number) => {
    if (audioRef.current) {
      audioRef.current.currentTime = time;
      if (!isPlaying) {
        audioRef.current.play();
        setIsPlaying(true);
      }
    }
  };

  return (
    <div className="min-h-screen bg-[#F5F5F3] text-[#1A1A1A] font-sans selection:bg-[#1A1A1A] selection:text-white">
      {/* Background Grid */}
      <div className="fixed inset-0 pointer-events-none opacity-[0.03] bg-[radial-gradient(#000_1px,transparent_1px)] [background-size:20px_20px]"></div>

      <header className="sticky top-0 z-50 bg-[#F5F5F3]/80 backdrop-blur-md border-b border-[#1A1A1A]/10 px-6 py-4 flex justify-between items-center">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-[#1A1A1A] rounded-full flex items-center justify-center text-white">
            <FileAudio size={20} />
          </div>
          <div>
            <h1 className="font-bold text-xl tracking-tight">Cognicly Inc.</h1>
            <p className="text-[10px] uppercase tracking-widest text-[#1A1A1A]/50 font-medium">Professional Audio Intelligence App</p>
          </div>
        </div>
        {report && (
          <button 
            onClick={downloadReport}
            className="flex items-center gap-2 px-4 py-2 bg-[#1A1A1A] text-white rounded-full text-sm font-medium hover:scale-105 transition-transform active:scale-95"
          >
            <Download size={16} />
            Export Report
          </button>
        )}
      </header>

      <main className="max-w-6xl mx-auto p-6 lg:p-12">
        <AnimatePresence mode="wait">
          {!report ? (
            <motion.div 
              key="upload"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="flex flex-col items-center justify-center min-h-[60vh] text-center"
            >
              <div className="max-w-2xl">
                <h2 className="text-5xl md:text-7xl font-bold tracking-tighter mb-6 leading-[0.9]">
                  Speech to <span className="italic font-serif">Structure.</span>
                </h2>
                <p className="text-lg text-[#1A1A1A]/60 mb-12 max-w-lg mx-auto">
                  Upload your audio files for precise transcription, speaker identification, and AI-generated insights.
                </p>

                <div className="relative group">
                  <input
                    type="file"
                    accept="audio/*"
                    onChange={handleFileChange}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                    disabled={isProcessing}
                  />
                  <div className={cn(
                    "border-2 border-dashed border-[#1A1A1A]/20 rounded-3xl p-12 transition-all duration-300",
                    "group-hover:border-[#1A1A1A] group-hover:bg-white",
                    file && "border-[#1A1A1A] bg-white"
                  )}>
                    <div className="flex flex-col items-center gap-4">
                      {file ? (
                        <>
                          <div className="w-16 h-16 bg-[#F5F5F3] rounded-2xl flex items-center justify-center text-[#1A1A1A]">
                            <CheckCircle2 size={32} />
                          </div>
                          <div>
                            <p className="font-bold text-lg">{file.name}</p>
                            <p className="text-sm text-[#1A1A1A]/50">{(file.size / (1024 * 1024)).toFixed(2)} MB • Ready to process</p>
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="w-16 h-16 bg-[#F5F5F3] rounded-2xl flex items-center justify-center text-[#1A1A1A]/30">
                            <Upload size={32} />
                          </div>
                          <p className="font-medium">Drop audio here or click to browse</p>
                          <p className="text-xs text-[#1A1A1A]/40">MP3, WAV, M4A up to 50MB</p>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                {file && (
                  <motion.button
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    onClick={processAudio}
                    disabled={isProcessing}
                    className="mt-8 px-12 py-5 bg-[#1A1A1A] text-white rounded-full font-bold text-lg flex items-center gap-3 mx-auto hover:scale-105 transition-transform disabled:opacity-50 disabled:scale-100"
                  >
                    {isProcessing ? (
                      <div className="flex flex-col items-center gap-2">
                        <div className="flex items-center gap-3">
                          <Loader2 className="animate-spin" size={24} />
                          {processingStage === 'encoding' ? 'Preparing Audio...' : 'AI Transcription in Progress... Stay Tune.'}
                        </div>
                        <p className="text-xs font-normal opacity-50 uppercase tracking-widest">This may take up to a minute</p>
                      </div>
                    ) : (
                      <>
                        Process Recording
                      </>
                    )}
                  </motion.button>
                )}

                {error && (
                  <div className="mt-6 flex items-center gap-2 text-red-600 justify-center font-medium bg-red-50 py-3 px-6 rounded-xl">
                    <AlertCircle size={18} />
                    {error}
                  </div>
                )}
              </div>
            </motion.div>
          ) : (
            <motion.div 
              key="results"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="grid grid-cols-1 lg:grid-cols-12 gap-12"
            >
              <div className="lg:col-span-8 space-y-12">
                <section>
                  <label className="text-[10px] uppercase tracking-widest font-bold text-[#1A1A1A]/40 mb-4 block">TRANSCRIPTION</label>
                  <div className="space-y-8">
                    {report.segments.map((segment, idx) => (
                      <motion.div 
                        key={idx}
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: idx * 0.05 }}
                        className={cn(
                          "group flex gap-6 p-4 rounded-2xl transition-colors cursor-pointer hover:bg-white",
                          currentTime >= segment.startTime && currentTime <= (segment.endTime || segment.startTime + 5) && "bg-white ring-1 ring-[#1A1A1A]/5"
                        )}
                        onClick={() => jumpTo(segment.startTime)}
                      >
                        <div className="flex-shrink-0 w-16 text-right pt-1">
                          <span className="font-mono text-[11px] text-[#1A1A1A]/40 font-medium tracking-tighter">
                            {formatTimestamp(segment.startTime)}
                          </span>
                        </div>
                        <div className="flex-1 space-y-2">
                          <div className="flex items-center gap-2">
                            <span className="text-[11px] font-bold uppercase tracking-wider text-[#1A1A1A]/60">
                              {segment.speaker}
                            </span>
                            {currentTime >= segment.startTime && currentTime <= (segment.endTime || segment.startTime + 5) && (
                              <div className="w-1.5 h-1.5 bg-[#1A1A1A] rounded-full animate-pulse" />
                            )}
                          </div>
                          <p className="text-lg leading-relaxed text-[#1A1A1A]/90 font-medium">
                            {segment.text}
                          </p>
                        </div>
                      </motion.div>
                    ))}
                  </div>
                </section>
              </div>

              <aside className="lg:col-span-4 space-y-10">
                <div className="p-8 bg-white rounded-[32px] border border-[#1A1A1A]/5 space-y-6 sticky top-28">
                  <div>
                    <label className="text-[10px] uppercase tracking-widest font-bold text-[#1A1A1A]/40 mb-2 block">PROJECT TITLE</label>
                    <h3 className="text-2xl font-bold leading-tight">{report.title}</h3>
                  </div>

                  <div>
                    <label className="text-[10px] uppercase tracking-widest font-bold text-[#1A1A1A]/40 mb-2 block">AI SUMMARY</label>
                    <div className="prose prose-sm prose-neutral">
                      <div className="text-[#1A1A1A]/70 leading-relaxed font-medium capitalize-first">
                        <ReactMarkdown>
                          {report.summary}
                        </ReactMarkdown>
                      </div>
                    </div>
                  </div>

                  <div className="pt-6 border-t border-[#1A1A1A]/5">
                    <label className="text-[10px] uppercase tracking-widest font-bold text-[#1A1A1A]/40 mb-4 block">AUDIO PLAYER</label>
                    <div className="bg-[#F5F5F3] p-4 rounded-2xl flex items-center gap-4">
                      <button 
                        onClick={togglePlay}
                        className="w-12 h-12 bg-[#1A1A1A] rounded-full flex items-center justify-center text-white hover:scale-110 active:scale-95 transition-transform"
                      >
                        {isPlaying ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" className="ml-1" />}
                      </button>
                      <div className="flex-1">
                        <div className="text-[10px] font-mono font-bold mb-1">
                          {formatTimestamp(currentTime)} / {audioRef.current ? formatTimestamp(audioRef.current.duration) : '00:00'}
                        </div>
                        <div className="h-1 bg-[#1A1A1A]/10 rounded-full overflow-hidden">
                          <div 
                            className="h-full bg-[#1A1A1A]" 
                            style={{ 
                              width: `${audioRef.current ? (currentTime / audioRef.current.duration) * 100 : 0}%` 
                            }}
                          />
                        </div>
                      </div>
                    </div>
                  </div>

                  <button 
                    onClick={() => { setReport(null); setFile(null); }}
                    className="w-full flex items-center justify-center gap-2 py-4 text-[#1A1A1A]/40 hover:text-red-500 transition-colors text-sm font-bold uppercase tracking-widest"
                  >
                    <Trash2 size={16} />
                    Reset Project
                  </button>
                </div>
              </aside>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      <audio 
        ref={audioRef} 
        src={audioUrl || ''} 
        onTimeUpdate={() => setCurrentTime(audioRef.current?.currentTime || 0)}
        onEnded={() => setIsPlaying(false)}
        className="hidden"
      />

      <footer className="max-w-6xl mx-auto px-6 py-12 border-t border-[#1A1A1A]/10 flex flex-col md:flex-row justify-between items-center gap-4 text-[11px] font-bold uppercase tracking-[0.2em] text-[#1A1A1A]/30">
        <div>© 2026 Cognicly ANALYTICS</div>
        <div className="flex gap-8">
          <span>GDPR COMPLIANT</span>
          <span>ENTERPRISE GRADE</span>
          <span>GEMINI POWERED</span>
        </div>
      </footer>
    </div>
  );
}
