import React, { useState, useEffect } from 'react';
import { 
  Sparkles, 
  Download, 
  Copy, 
  Check, 
  Maximize2, 
  X, 
  RefreshCw, 
  Zap, 
  Clock, 
  Layers, 
  Sliders, 
  ExternalLink,
  ChevronDown,
  Image as ImageIcon
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { aiRouter } from '../services/aiRouter';
import { imageFileToDataUrl } from '../services/imageUtils';
import { firestoreService, TIERS } from '../services/firestoreService';
import { downloadMedia } from '../services/downloadService';

const STYLES = [
  { id: 'Photorealistic', name: 'Photorealistic 8K', preview: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&w=300&q=80' },
  { id: 'Azure Dream', name: 'Azure Glassmorphism', preview: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=300&q=80' },
  { id: 'Cyberpunk', name: 'Cyberpunk Neon', preview: 'https://images.unsplash.com/photo-1578632767115-351597cf2477?auto=format&fit=crop&w=300&q=80' },
  { id: 'Anime', name: 'Anime Aesthetic', preview: 'https://images.unsplash.com/photo-1579783902614-a3fb3927b675?auto=format&fit=crop&w=300&q=80' },
  { id: '3D Render', name: '3D Pixar Engine', preview: 'https://images.unsplash.com/photo-1634017839464-5c339ebe3cb4?auto=format&fit=crop&w=300&q=80' },
  { id: 'Oil Painting', name: 'Oil Painting Master', preview: 'https://images.unsplash.com/photo-1579783900882-c0d3dad7b119?auto=format&fit=crop&w=300&q=80' }
];

const ASPECT_RATIOS = [
  { id: '1:1', label: '1:1 Square', icon: '■' },
  { id: '16:9', label: '16:9 Wide', icon: '▬' },
  { id: '9:16', label: '9:16 Story', icon: '▮' },
  { id: '4:3', label: '4:3 Standard', icon: '▭' },
  { id: '3:4', label: '3:4 Portrait', icon: '▯' }
];

export const ImageGenerator = () => {
  const { currentUser, limits, usage, checkUsage, refreshProfile, setIsUsageModalOpen } = useAuth();

  const [prompt, setPrompt] = useState('');
  const [negativePrompt, setNegativePrompt] = useState('');
  const [selectedStyle, setSelectedStyle] = useState('Photorealistic');
  const [aspectRatio, setAspectRatio] = useState('1:1');
  const [loading, setLoading] = useState(false);
  const [gallery, setGallery] = useState([]);
  const [lightboxImage, setLightboxImage] = useState(null);
  const [copiedPromptId, setCopiedPromptId] = useState(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [sourceImage, setSourceImage] = useState(null);

  // Load previous generated images from Firestore / LocalStorage
  const loadGallery = async () => {
    if (!currentUser?.uid) return;
    const items = await firestoreService.getUserAssets(currentUser.uid, 'image');
    setGallery(items);
  };

  useEffect(() => {
    loadGallery();
  }, [currentUser?.uid]);

  const handleGenerate = async () => {
    if (!prompt.trim() || loading) return;

    // 1. Check Usage Limits
      const usageCheck = await checkUsage('image');
      if (!usageCheck.allowed) {
        return;
      }

    setLoading(true);

    try {
      const result = await aiRouter.generateImage({
        prompt: prompt.trim(),
        negativePrompt: negativePrompt.trim(),
        style: selectedStyle,
        aspectRatio,
        sourceImage: sourceImage?.dataUrl || ''
      });

      if (!result?.url) throw new Error('Image provider returned no downloadable image.');
      await refreshProfile();

      // Save asset in Firestore
      const assetData = {
        type: 'image',
        url: result.url,
        prompt: prompt.trim(),
        enhancedPrompt: result.enhancedPrompt,
        style: selectedStyle,
        aspectRatio,
        provider: result.provider,
        model: result.model
      };

      const saved = await firestoreService.saveAsset(currentUser.uid, assetData);
      setGallery(prev => [saved, ...prev]);
    } catch (err) {
      console.error('Image generation error:', err);
      if (err.status === 403) setIsUsageModalOpen(true);
      alert(err.message || 'Encountered an issue generating image.');
    } finally {
      setLoading(false);
    }
  };

  const handleSourceImage = async event => {
    const file = event.target.files?.[0];
    if (!file || !file.type.startsWith('image/')) return;
    try {
      const dataUrl = await imageFileToDataUrl(file, { maxDimension: 1536, maxBytes: 1_200_000 });
      setSourceImage({ name: file.name, dataUrl });
    } catch (error) {
      alert(error.message);
    }
    event.target.value = '';
  };

  const handleCopyPrompt = (text, id) => {
    navigator.clipboard.writeText(text);
    setCopiedPromptId(id);
    setTimeout(() => setCopiedPromptId(null), 2000);
  };

  const handleDownload = async (url, filename) => {
    try {
      await downloadMedia(url, `${filename || 'zulora-art'}.png`);
    } catch (e) {
      console.error('Image download failed:', e.message);
    }
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col h-full overflow-y-auto px-3 py-4 sm:px-8 sm:py-6 max-w-7xl mx-auto w-full space-y-5 sm:space-y-8">
      
      {/* Header Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-6 rounded-3xl glass-pearl dark:glass-dark border border-slate-200/90 dark:border-slate-800 shadow-glass">
        <div>
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-xl bg-sky-500/10 text-sky-500 border border-sky-500/20 text-xs font-bold mb-2">
            <Sparkles className="w-3.5 h-3.5" />
            <span>Zulora Image Studio • Multi-Engine HD</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white">
            High-Resolution Visual Synthesis
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-1 max-w-xl">
            Synthesize masterworks with FLUX.1-schnell, SDXL, and Fal AI. Optimized by Shiven Panwar.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <label className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white/70 dark:bg-slate-900/70 text-xs font-semibold text-slate-700 dark:text-slate-300 cursor-pointer hover:border-sky-500">
            <ImageIcon className="w-4 h-4 text-sky-500" />
            <span>{sourceImage ? 'Replace reference image' : 'Upload reference image'}</span>
            <input type="file" accept="image/*" onChange={handleSourceImage} className="hidden" />
          </label>
          {sourceImage && (
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <img src={sourceImage.dataUrl} alt="Reference" className="w-10 h-10 rounded-lg object-cover" />
              <span className="max-w-[14rem] truncate">{sourceImage.name}</span>
              <button type="button" onClick={() => setSourceImage(null)} className="p-1 rounded-md hover:bg-slate-200 dark:hover:bg-slate-800" title="Remove reference image">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>

        {/* Credit Tracker Pill */}
        <div 
          onClick={() => setIsUsageModalOpen(true)}
          className="flex items-center gap-3 p-3 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm cursor-pointer hover:border-sky-500 transition-colors"
        >
          <div className="p-2 rounded-xl bg-sky-50 dark:bg-sky-950/60 text-sky-500">
            <Zap className="w-5 h-5" />
          </div>
          <div>
            <div className="text-[11px] text-slate-400 font-medium">Daily Images Used</div>
            <div className="text-sm font-bold text-slate-900 dark:text-white">
              {usage.imageCount || 0} / <span className="text-sky-500">{limits.image}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Main Studio Controls */}
      <div className="p-5 sm:p-6 rounded-3xl glass-pearl dark:glass-dark border border-slate-200/90 dark:border-slate-800 shadow-glass space-y-6">
        
        {/* Prompt Input */}
        <div>
          <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-2">
            Image Prompt Description
          </label>
          <div className="relative">
            <textarea
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              placeholder="e.g. A hyper-realistic glassmorphic cybernetic tiger perched on a crystal spire overlooking an azure futuristic metropolis, volumetric lighting, 8k..."
              rows={3}
              className="w-full p-4 rounded-2xl bg-white/80 dark:bg-slate-900/80 border border-slate-300 dark:border-slate-700 text-xs sm:text-sm text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 resize-none transition-all shadow-inner"
            />
          </div>
        </div>

        {/* Style Presets Carousel */}
        <div>
          <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-2.5">
            Art Style Preset
          </label>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2.5">
            {STYLES.map(style => {
              const isSelected = selectedStyle === style.id;
              return (
                <div
                  key={style.id}
                  onClick={() => setSelectedStyle(style.id)}
                  className={`group relative rounded-2xl overflow-hidden cursor-pointer border transition-all ${
                    isSelected
                      ? 'border-sky-500 ring-2 ring-sky-500/30 shadow-azure-glow scale-[1.02]'
                      : 'border-slate-200 dark:border-slate-800 hover:border-slate-400 dark:hover:border-slate-600 opacity-80 hover:opacity-100'
                  }`}
                >
                  <img
                    src={style.preview}
                    alt={style.name}
                    className="w-full h-20 object-cover group-hover:scale-105 transition-transform duration-300"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/40 to-transparent flex items-end p-2">
                    <span className="text-[11px] font-bold text-white drop-shadow truncate">
                      {style.name}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Aspect Ratio & Options */}
        <div className="flex flex-wrap items-center justify-between gap-4 pt-2 border-t border-slate-200/80 dark:border-slate-800">
          
          {/* Aspect Ratio Selector */}
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-slate-600 dark:text-slate-400 mr-1">Ratio:</span>
            <div className="flex flex-wrap gap-1.5">
              {ASPECT_RATIOS.map(ratio => (
                <button
                  key={ratio.id}
                  type="button"
                  onClick={() => setAspectRatio(ratio.id)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 border transition-all ${
                    aspectRatio === ratio.id
                      ? 'bg-sky-500 text-white border-sky-400 shadow-sm'
                      : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-800 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  <span>{ratio.icon}</span>
                  <span>{ratio.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Advanced toggle */}
          <button
            type="button"
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-sky-500 transition-colors"
          >
            <Sliders className="w-3.5 h-3.5" />
            <span>{showAdvanced ? 'Hide Advanced' : 'Negative Prompt'}</span>
          </button>

        </div>

        {/* Advanced Options: Negative Prompt */}
        {showAdvanced && (
          <div className="p-4 rounded-2xl bg-slate-100/70 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-800 animate-slide-up">
            <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider mb-1">
              Negative Prompt (Things to avoid)
            </label>
            <input
              type="text"
              value={negativePrompt}
              onChange={e => setNegativePrompt(e.target.value)}
              placeholder="e.g. blurry, low quality, distorted, extra limbs, watermark, bad anatomy"
              className="w-full px-3 py-2 rounded-xl bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-sky-500"
            />
          </div>
        )}

        {/* Generate Button */}
        <div className="pt-2">
          <button
            onClick={handleGenerate}
            disabled={!prompt.trim() || loading}
            className={`w-full py-3.5 rounded-2xl text-sm font-bold flex items-center justify-center gap-2 shadow-lg transition-all ${
              !prompt.trim() || loading
                ? 'bg-slate-200 dark:bg-slate-800 text-slate-400 cursor-not-allowed'
                : 'text-white azure-gradient-btn'
            }`}
          >
            {loading ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                <span>Generating High-Resolution Asset...</span>
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4" />
                <span>Generate Masterpiece</span>
              </>
            )}
          </button>
        </div>

      </div>

      {/* Gallery Section */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <Layers className="w-4 h-4 text-sky-500" />
            <span>Your Generated Creations</span>
          </h2>
          <span className="text-xs text-slate-500">{gallery.length} Images</span>
        </div>

        {gallery.length === 0 ? (
          <div className="py-12 text-center rounded-3xl border border-dashed border-slate-300 dark:border-slate-800 p-8">
            <Sparkles className="w-10 h-10 mx-auto text-slate-300 dark:text-slate-700 mb-3" />
            <h3 className="text-sm font-bold text-slate-700 dark:text-slate-300">No images created yet</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-sm mx-auto">
              Type your imaginative prompt above and select a style preset to start crafting images!
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {gallery.map(item => (
              <div
                key={item.id}
                className="group relative rounded-2xl overflow-hidden glass-pearl dark:glass-dark border border-slate-200 dark:border-slate-800 shadow-sm hover:shadow-lg transition-all"
              >
                <div className="relative aspect-square overflow-hidden bg-slate-900">
                  <img
                    src={item.url}
                    alt={item.prompt}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    loading="lazy"
                  />
                  
                  {/* Floating Action Overlay */}
                  <div className="absolute inset-0 bg-slate-950/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2 p-3">
                    <button
                      onClick={() => setLightboxImage(item)}
                      className="p-2 rounded-xl bg-white/20 hover:bg-white/30 text-white backdrop-blur-md"
                      title="Enlarge"
                    >
                      <Maximize2 className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleDownload(item.url, `zulora_${item.id}`)}
                      className="p-2 rounded-xl bg-white/20 hover:bg-white/30 text-white backdrop-blur-md"
                      title="Download image"
                    >
                      <Download className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleCopyPrompt(item.prompt, item.id)}
                      className="p-2 rounded-xl bg-white/20 hover:bg-white/30 text-white backdrop-blur-md"
                      title="Copy prompt"
                    >
                      {copiedPromptId === item.id ? (
                        <Check className="w-4 h-4 text-emerald-400" />
                      ) : (
                        <Copy className="w-4 h-4" />
                      )}
                    </button>
                  </div>

                  {/* Ratio badge */}
                  <div className="absolute top-2 left-2 px-2 py-0.5 rounded-lg bg-slate-950/70 backdrop-blur-md text-[10px] font-bold text-white border border-white/10">
                    {item.aspectRatio || '1:1'}
                  </div>
                </div>

                {/* Prompt Caption */}
                <div className="p-3">
                  <p className="text-xs text-slate-700 dark:text-slate-300 font-medium line-clamp-2">
                    {item.prompt}
                  </p>
                  <div className="mt-2 flex items-center justify-between text-[10px] text-slate-400">
                    <span className="font-semibold text-sky-500">{item.style || 'Photorealistic'}</span>
                    <span>{new Date(item.createdAt).toLocaleDateString()}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Lightbox Modal */}
      {lightboxImage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/90 backdrop-blur-xl animate-fade-in">
          <div className="relative max-w-4xl w-full rounded-3xl overflow-hidden glass-dark border border-slate-800 shadow-2xl p-4 sm:p-6 space-y-4">
            
            {/* Lightbox Header */}
            <div className="flex items-center justify-between">
              <div>
                <span className="text-xs font-bold text-sky-400">{lightboxImage.style}</span>
                <h3 className="text-sm font-semibold text-white truncate max-w-md">
                  {lightboxImage.prompt}
                </h3>
              </div>
              <button
                onClick={() => setLightboxImage(null)}
                className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Main Lightbox Image View */}
            <div className="relative max-h-[65vh] flex items-center justify-center rounded-2xl overflow-hidden bg-slate-900">
              <img
                src={lightboxImage.url}
                alt={lightboxImage.prompt}
                className="max-h-[65vh] w-auto object-contain rounded-xl"
              />
            </div>

            {/* Bottom Actions */}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-800">
              <div className="text-xs text-slate-400">
                Provider: <span className="text-slate-200 font-semibold">{lightboxImage.provider || 'Pollinations FLUX'}</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleCopyPrompt(lightboxImage.prompt, 'lightbox')}
                  className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 flex items-center gap-1.5 transition-colors"
                >
                  {copiedPromptId === 'lightbox' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>Copy Prompt</span>
                </button>
                <button
                  onClick={() => handleDownload(lightboxImage.url, `zulora_${lightboxImage.id}`)}
                  className="px-4 py-2 rounded-xl azure-gradient-btn text-xs font-bold text-white flex items-center gap-1.5"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Download Ultra HD</span>
                </button>
              </div>
            </div>

          </div>
        </div>
      )}

    </div>
  );
};

export default ImageGenerator;
