import React, { useState, useEffect, useRef } from 'react';
import { 
  Film, 
  Play, 
  Pause, 
  RotateCcw, 
  Download, 
  Maximize2, 
  Zap, 
  Sliders, 
  Video as VideoIcon, 
  Sparkles,
  RefreshCw,
  Camera,
  Layers
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { aiRouter } from '../services/aiRouter';
import { firestoreService } from '../services/firestoreService';
import { downloadMedia } from '../services/downloadService';

const CAMERA_ANGLES = [
  'Cinematic Pan',
  '360 Orbit Shot',
  'Dramatic Zoom In',
  'Drone Aerial Flyover',
  'Slow Motion Glide',
  'FPV High-Speed Track'
];

export const VideoGenerator = () => {
  const { currentUser, limits, usage, checkUsage, recordUsage, setIsUsageModalOpen } = useAuth();

  const [prompt, setPrompt] = useState('');
  const [motionSpeed, setMotionSpeed] = useState(5);
  const [cameraAngle, setCameraAngle] = useState('Cinematic Pan');
  const [duration, setDuration] = useState(6);
  const [loading, setLoading] = useState(false);
  const [gallery, setGallery] = useState([]);
  const [activeVideo, setActiveVideo] = useState(null);
  const [isPlaying, setIsPlaying] = useState(true);
  const generatingRef = useRef(false);

  // Load user generated videos from Firestore / LocalStorage
  const loadVideos = async () => {
    if (!currentUser?.uid) return;
    const items = await firestoreService.getUserAssets(currentUser.uid, 'video');
    setGallery(items);
    if (items.length > 0 && !activeVideo) {
      setActiveVideo(items[0]);
    }
  };

  useEffect(() => {
    loadVideos();
  }, [currentUser?.uid]);

  const handleGenerate = async () => {
    if (!prompt.trim() || loading || generatingRef.current) return;
    generatingRef.current = true;
    let allowance;
    try { allowance = await checkUsage('video'); }
    catch (error) {
      generatingRef.current = false;
      console.warn('Could not check video usage:', error.message);
      setIsUsageModalOpen(true);
      return;
    }
    if (!allowance.allowed) {
      generatingRef.current = false;
      return;
    }

    setLoading(true);

    try {
      const result = await aiRouter.generateVideo({
        prompt: prompt.trim(),
        motionSpeed,
        cameraAngle,
        duration,
        currentUser
      });
      if (!result?.url) throw new Error('Video provider returned no video.');
      await recordUsage('video', Boolean(result.usage?.tracked));

      const videoAsset = {
        type: 'video',
        url: result.url,
        prompt: prompt.trim(),
        cameraAngle,
        motionSpeed,
        duration: result.duration || duration,
        provider: result.provider,
        model: result.model
      };

      const saved = await firestoreService.saveAsset(currentUser.uid, videoAsset);
      setGallery(prev => [saved, ...prev]);
      setActiveVideo(saved);
      setIsPlaying(true);
    } catch (err) {
      console.error('Video generation error:', err);
      if (err.status === 403) setIsUsageModalOpen(true);
      alert(err.message || 'Encountered an issue generating video. Please try again.');
    } finally {
      setLoading(false);
      generatingRef.current = false;
    }
  };

  const handleDownload = async (url, filename) => {
    try {
      await downloadMedia(url, `${filename || 'zulora-clip'}.mp4`);
    } catch (e) {
      console.error('Video download failed:', e.message);
    }
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col h-full overflow-y-auto px-3 py-4 sm:px-8 sm:py-6 max-w-7xl mx-auto w-full space-y-5 sm:space-y-8">
      
      {/* Header Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-6 rounded-3xl glass-pearl dark:glass-dark border border-slate-200/90 dark:border-slate-800 shadow-glass">
        <div>
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-xl bg-indigo-500/10 text-indigo-500 border border-indigo-500/20 text-xs font-bold mb-2">
            <Film className="w-3.5 h-3.5" />
            <span>Zulora Video Studio • AI Motion Cinema</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white">
            Cinematic AI Video Generation
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-1 max-w-xl">
            Transform ideas and prompts into dynamic HD motion sequences with automated camera trajectories and lighting.
          </p>
        </div>

        {/* Credit Tracker Pill */}
        <div 
          onClick={() => setIsUsageModalOpen(true)}
          className="flex items-center gap-3 p-3 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm cursor-pointer hover:border-indigo-500 transition-colors"
        >
          <div className="p-2 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 text-indigo-500">
            <Zap className="w-5 h-5" />
          </div>
          <div>
            <div className="text-[11px] text-slate-400 font-medium">Daily Videos Used</div>
            <div className="text-sm font-bold text-slate-900 dark:text-white">
              {usage.videoCount || 0} / <span className="text-indigo-500">{limits.video}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Main Video Generation Studio */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Left Column: Generation Controls */}
        <div className="lg:col-span-5 p-5 sm:p-6 rounded-3xl glass-pearl dark:glass-dark border border-slate-200/90 dark:border-slate-800 shadow-glass space-y-5">
          
          {/* Prompt */}
          <div>
            <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-2">
              Video Concept & Scene Action
            </label>
            <textarea
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              placeholder="e.g. Glowing cybernetic jellyfish floating through an azure neon abyssal ocean, bioluminescent trails, cinematic 4k drone shot..."
              rows={4}
              className="w-full p-4 rounded-2xl bg-white/80 dark:bg-slate-900/80 border border-slate-300 dark:border-slate-700 text-xs sm:text-sm text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 resize-none transition-all shadow-inner"
            />
          </div>

          {/* Camera Trajectory Presets */}
          <div>
            <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <Camera className="w-3.5 h-3.5 text-indigo-500" />
              <span>Camera Movement Preset</span>
            </label>
            <div className="grid grid-cols-2 gap-2">
              {CAMERA_ANGLES.map(angle => (
                <button
                  key={angle}
                  type="button"
                  onClick={() => setCameraAngle(angle)}
                  className={`px-3 py-2 rounded-xl text-xs font-semibold transition-all border text-left truncate ${
                    cameraAngle === angle
                      ? 'bg-indigo-500 text-white border-indigo-400 shadow-sm'
                      : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-800 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  {angle}
                </button>
              ))}
            </div>
          </div>

          {/* Motion Speed & Duration Sliders */}
          <div className="space-y-4 pt-2 border-t border-slate-200/80 dark:border-slate-800">
            <div>
              <div className="flex justify-between text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                <span>Motion Intensity</span>
                <span className="text-indigo-500 font-bold">{motionSpeed}x</span>
              </div>
              <input
                type="range"
                min="1"
                max="10"
                value={motionSpeed}
                onChange={e => setMotionSpeed(Number(e.target.value))}
                className="w-full h-1.5 bg-slate-200 dark:bg-slate-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
              />
            </div>

            <div>
              <div className="flex justify-between text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                <span>Duration</span>
                <span className="text-indigo-500 font-bold">{duration} Seconds</span>
              </div>
              <div className="flex gap-2">
                {[6, 10].map(d => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setDuration(d)}
                    className={`flex-1 py-1.5 rounded-xl text-xs font-bold border transition-all ${
                      duration === d
                        ? 'bg-indigo-500 text-white border-indigo-400 shadow-sm'
                        : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-800'
                    }`}
                  >
                    {d}s HD
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Generate Button */}
          <div className="pt-2">
            <button
              onClick={handleGenerate}
              disabled={!prompt.trim() || loading}
              className={`w-full py-3.5 rounded-2xl text-sm font-bold flex items-center justify-center gap-2 shadow-lg transition-all ${
                !prompt.trim() || loading
                  ? 'bg-slate-200 dark:bg-slate-800 text-slate-400 cursor-not-allowed'
                  : 'text-white bg-gradient-to-r from-indigo-500 via-sky-500 to-blue-600 hover:from-indigo-600 hover:to-blue-700 shadow-indigo-500/25'
              }`}
            >
              {loading ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Synthesizing Motion Frames...</span>
                </>
              ) : (
                <>
                  <Film className="w-4 h-4" />
                  <span>Generate Video Clip</span>
                </>
              )}
            </button>
          </div>

        </div>

        {/* Right Column: Active Video Player Preview */}
        <div className="lg:col-span-7 flex flex-col p-5 sm:p-6 rounded-3xl glass-pearl dark:glass-dark border border-slate-200/90 dark:border-slate-800 shadow-glass">
          
          <div className="flex items-center justify-between mb-4">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-2">
              <VideoIcon className="w-4 h-4 text-indigo-500" />
              <span>Cinematic Playback</span>
            </span>
            {activeVideo && (
              <span className="text-xs font-semibold text-indigo-400">
                {activeVideo.provider || 'Zulora Cinema'}
              </span>
            )}
          </div>

          {/* Main Video Screen */}
          <div className="relative aspect-video rounded-2xl overflow-hidden bg-slate-950 flex items-center justify-center border border-slate-800 shadow-2xl">
            {activeVideo ? (
              <video
                key={activeVideo.url}
                src={activeVideo.url}
                autoPlay
                loop
                muted
                playsInline
                className="w-full h-full object-cover rounded-xl"
              />
            ) : (
              <div className="text-center p-6 text-slate-500">
                <Film className="w-12 h-12 mx-auto text-slate-700 mb-2" />
                <p className="text-xs font-semibold">Your synthesized video will play here</p>
                <p className="text-[11px] text-slate-600 mt-1">Select an angle and describe your scene</p>
              </div>
            )}
          </div>

          {/* Active Video Details & Download */}
          {activeVideo && (
            <div className="mt-4 pt-3 border-t border-slate-200/80 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
              <div className="max-w-md">
                <p className="text-xs font-semibold text-slate-800 dark:text-slate-200 truncate">
                  {activeVideo.prompt}
                </p>
                <div className="text-[10px] text-slate-400 flex items-center gap-2 mt-0.5">
                  <span>{activeVideo.cameraAngle}</span>
                  <span>•</span>
                  <span>{activeVideo.duration || 4}s Duration</span>
                  <span>•</span>
                  <span>{new Date(activeVideo.createdAt).toLocaleDateString()}</span>
                </div>
              </div>

              <button
                onClick={() => handleDownload(activeVideo.url, `zulora_${activeVideo.id}`)}
                className="px-4 py-2 rounded-xl bg-gradient-to-r from-indigo-500 to-sky-500 text-white text-xs font-bold flex items-center gap-1.5 shadow-md hover:opacity-95"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Download MP4</span>
              </button>
            </div>
          )}

        </div>

      </div>

      {/* Video Gallery Section */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <Layers className="w-4 h-4 text-indigo-500" />
            <span>Recent Video Clips</span>
          </h2>
          <span className="text-xs text-slate-500">{gallery.length} Videos</span>
        </div>

        {gallery.length === 0 ? (
          <div className="py-12 text-center rounded-3xl border border-dashed border-slate-300 dark:border-slate-800 p-8">
            <Film className="w-10 h-10 mx-auto text-slate-300 dark:text-slate-700 mb-3" />
            <h3 className="text-sm font-bold text-slate-700 dark:text-slate-300">No videos synthesized yet</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-sm mx-auto">
              Choose a prompt and camera motion preset above to generate your first AI cinematic motion sequence.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            {gallery.map(item => (
              <div
                key={item.id}
                onClick={() => setActiveVideo(item)}
                className={`group relative rounded-2xl overflow-hidden glass-pearl dark:glass-dark border cursor-pointer transition-all ${
                  activeVideo?.id === item.id
                    ? 'border-indigo-500 ring-2 ring-indigo-500/30 shadow-lg'
                    : 'border-slate-200 dark:border-slate-800 hover:border-slate-400 dark:hover:border-slate-600'
                }`}
              >
                <div className="relative aspect-video bg-slate-950 overflow-hidden">
                  <video
                    src={item.url}
                    muted
                    loop
                    onMouseEnter={e => e.target.play()}
                    onMouseLeave={e => e.target.pause()}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                  />
                  <div className="absolute top-2 left-2 px-2 py-0.5 rounded-lg bg-slate-950/70 backdrop-blur-md text-[10px] font-bold text-white">
                    {item.cameraAngle}
                  </div>
                  <div className="absolute inset-0 bg-slate-950/30 group-hover:bg-transparent transition-colors flex items-center justify-center">
                    <div className="p-2 rounded-full bg-white/20 backdrop-blur-md text-white group-hover:scale-110 transition-transform">
                      <Play className="w-4 h-4 fill-white" />
                    </div>
                  </div>
                </div>

                <div className="p-3">
                  <p className="text-xs text-slate-700 dark:text-slate-300 font-semibold truncate">
                    {item.prompt}
                  </p>
                  <div className="flex items-center justify-between text-[10px] text-slate-400 mt-1">
                    <span>{item.duration || 4}s</span>
                    <span>{new Date(item.createdAt).toLocaleDateString()}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

    </div>
  );
};

export default VideoGenerator;
