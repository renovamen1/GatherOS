import React, { useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import {
  PanelLeft,
  ChevronLeft,
  Download,
  Pipette,
  Trash2,
  X as LucideX,
  Play,
  Pause,
  Volume2,
  VolumeX,
} from 'lucide-react';
import styles from './FocusedView.module.css';
import { fileUrl } from '../lib/fileUrl.js';
import { tweetMediaItems } from '../lib/tweetMedia.js';
import { useEyedropper } from '../hooks/useEyedropper.js';
import TweetCard from './TweetCard.jsx';

const ZOOM_MIN = 0.25;
const ZOOM_MAX = 3;
const ZOOM_STEP = 0.05;

function EyedropperLoupe({ loupe, hex, copied, pos }) {
  const canvasRef = useRef(null);
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv || !loupe) return;
    if (cv.width !== loupe.n) cv.width = loupe.n;
    if (cv.height !== loupe.n) cv.height = loupe.n;
    const ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, loupe.n, loupe.n);
    ctx.putImageData(loupe.block, 0, 0);
  }, [loupe]);
  return (
    <div
      className={[styles.loupe, copied && styles.loupeCopied].filter(Boolean).join(' ')}
      style={{
        left: pos.x || window.innerWidth / 2,
        top: pos.y || window.innerHeight / 2,
        '--loupe-color': hex || '#ffffff',
      }}
      aria-hidden="true"
    >
      <div className={styles.loupeDisc}>
        <canvas ref={canvasRef} className={styles.loupeCanvas} />
        <span className={styles.loupeReticle} />
      </div>
      <div className={styles.loupeLabel}>
        {copied ? (
          <span className={styles.loupeCopiedText}>Copied</span>
        ) : (
          <>
            <span className={styles.loupeSwatch} style={{ background: hex }} />
            <span>{hex}</span>
          </>
        )}
      </div>
    </div>
  );
}

const FV_ICON = { strokeWidth: 1.6, 'aria-hidden': true };
const SidebarIcon = () => <PanelLeft {...FV_ICON} />;
const ExportIcon = () => <Download {...FV_ICON} />;
const EyedropperIcon = () => <Pipette {...FV_ICON} />;
const TrashIcon = () => <Trash2 {...FV_ICON} />;
const CloseIcon = () => <LucideX {...FV_ICON} strokeWidth={1.8} />;

function defaultExportName(record) {
  const ext = (record.file_path.split('.').pop() || 'png').toLowerCase();
  if (record.title) return `${record.title}.${ext}`;
  return `moodmark-${record.id.slice(0, 8)}.${ext}`;
}

export default function FocusedView({
  record,
  index,
  total,
  onBack,
  onPrev,
  onNext,
  hasPrev,
  hasNext,
  onDelete,
  onToggleSidebar,
  morphSource = false,
  onContextMenu,
  videoMuted = true,
  onVideoMutedChange,
  altImageIdx = 0,
}) {
  const [zoom, setZoom] = useState(1);
  const [videoHovered, setVideoHovered] = useState(false);
  const videoRef = useRef(null);
  const [vid, setVid] = useState({ playing: true, current: 0, duration: 0 });
  useEffect(() => { setVid({ playing: true, current: 0, duration: 0 }); }, [record.id]);
  useEffect(() => {
    const v = videoRef.current;
    if (v) v.muted = videoMuted;
  }, [videoMuted]);
  const fmtTime = (s) => {
    const t = Math.max(0, Math.floor(s || 0));
    return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
  };
  const toggleVideoPlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) v.play().catch(() => {});
    else v.pause();
  };
  const toggleVideoMute = () => {
    const next = !videoMuted;
    const v = videoRef.current;
    if (v) v.muted = next;
    onVideoMutedChange?.(next);
  };
  const seekVideo = (e) => {
    const v = videoRef.current;
    if (!v || !v.duration) return;
    v.currentTime = (Number(e.target.value) / 1000) * v.duration;
  };
  const [openedViaMorph] = useState(morphSource);
  const stageRef = useRef(null);
  const imageRef = useRef(null);
  const {
    picking,
    togglePicking,
    handleImageClick: handlePickerClick,
    handleImageMouseMove,
    hoverHex,
    hoverPos,
    justCopied,
    loupe,
  } = useEyedropper(imageRef, record.id);

  useEffect(() => {
    setZoom(1);
  }, [record.id]);

  useEffect(() => {
    let meta = null;
    try { meta = JSON.parse(record.tweet_meta || 'null'); } catch { /* ignore */ }
    const remote = tweetMediaItems(record, meta)
      .filter((m) => m.type === 'image' && !m.primary)
      .map((m) => m.url);
    if (remote.length === 0) return undefined;
    const large = (u) => {
      try { const x = new URL(u); x.searchParams.set('name', 'large'); return x.toString(); }
      catch { return u; }
    };
    const imgs = remote.map((u) => {
      const im = new Image();
      im.decoding = 'async';
      im.src = large(u);
      return im;
    });
    return () => { imgs.forEach((im) => { im.src = ''; }); };
  }, [record.id, record.tweet_meta]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    stage.scrollLeft = Math.max(0, (stage.scrollWidth - stage.clientWidth) / 2);
    stage.scrollTop = Math.max(0, (stage.scrollHeight - stage.clientHeight) / 2);
  }, [zoom, record.id]);

  useEffect(() => {
    function onKey(e) {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if (e.key === 'Escape') {
        if (document.fullscreenElement) return;
        e.preventDefault();
        if (picking) {
          togglePicking();
          return;
        }
        onBack();
      } else if (e.key === 'ArrowLeft' && hasPrev) {
        e.preventDefault();
        onPrev();
      } else if (e.key === 'ArrowRight' && hasNext) {
        e.preventDefault();
        onNext();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onBack, onPrev, onNext, hasPrev, hasNext, picking, togglePicking]);

  let tweetMeta = null;
  if (record.tweet_meta) {
    try {
      tweetMeta = JSON.parse(record.tweet_meta) || null;
    } catch { /* malformed tweet_meta */ }
  }
  const isTweet = record.kind === 'tweet' && !!tweetMeta;
  function twimgLarge(url) {
    try {
      const u = new URL(url);
      if (!/(^|\.)twimg\.com$/i.test(u.hostname)) return url;
      u.searchParams.set('name', 'large');
      return u.toString();
    } catch { return url; }
  }
  const media = tweetMediaItems(record, tweetMeta);
  const activeMedia = media.length > 0
    ? media[Math.min(Math.max(altImageIdx, 0), media.length - 1)]
    : null;
  const showVideo = activeMedia ? activeMedia.type === 'video' : record.kind === 'video';
  const localVideo = !activeMedia || activeMedia.primaryLocal || !activeMedia.url;
  const videoSrc = localVideo ? fileUrl(record.file_path) : activeMedia.url;

  useEffect(() => {
    if (showVideo && picking) togglePicking();
  }, [showVideo, picking, togglePicking]);
  const videoPoster = (showVideo && !localVideo && activeMedia.poster)
    ? activeMedia.poster
    : (record.thumb_path ? fileUrl(record.thumb_path) : undefined);
  const src = (activeMedia && activeMedia.type === 'image')
    ? (activeMedia.primary ? fileUrl(record.file_path) : twimgLarge(activeMedia.url))
    : fileUrl(record.file_path);
  const zoomFillPct = ((zoom - ZOOM_MIN) / (ZOOM_MAX - ZOOM_MIN)) * 100;

  const handleExport = () => {
    window.moodmark.image.export(record.file_path, defaultExportName(record));
  };

  return (
    <div
      className={[
        styles.focused,
        openedViaMorph && styles.focusedMorphing,
      ].filter(Boolean).join(' ')}
      style={(() => {
        const bg = record.kind === 'video' && record.thumb_path
          ? fileUrl(record.thumb_path)
          : src;
        return bg ? { '--stage-bg': `url(${JSON.stringify(bg)})` } : undefined;
      })()}
    >
      <div className={styles.topBar}>
        {onToggleSidebar && (
          <button
            type="button"
            className={styles.iconBtn}
            onClick={onToggleSidebar}
            title="Toggle sidebar"
          >
            <SidebarIcon />
          </button>
        )}
        <button
          type="button"
          className={styles.backBtn}
          onClick={onBack}
          aria-label="Back to grid"
          title="Back to grid (Esc)"
        >
          <ChevronLeft size={18} strokeWidth={1.6} aria-hidden="true" />
        </button>

        {total > 1 && (
          <div className={styles.counter}>
            {index + 1} / {total}
          </div>
        )}

        <div className={styles.actions}>
          <div className={styles.zoom} title="Zoom">
            <button
              type="button"
              className={styles.zoomLabel}
              onClick={() => setZoom(1)}
              title="Reset to 100%"
            >
              {Math.round(zoom * 100)}%
            </button>
            <input
              type="range"
              min={ZOOM_MIN}
              max={ZOOM_MAX}
              step={ZOOM_STEP}
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
              className={styles.slider}
              style={{ '--zoom-fill': `${zoomFillPct}%` }}
              aria-label="Zoom"
            />
          </div>

          <span className={styles.divider} aria-hidden="true" />

          {record.kind !== 'url' && !isTweet && !showVideo && (
            <button
              type="button"
              className={[styles.iconBtn, picking && styles.iconBtnActive]
                .filter(Boolean)
                .join(' ')}
              data-tooltip={picking ? 'Click image to sample' : 'Pick a color'}
              data-tooltip-pos="below"
              aria-label={picking ? 'Click image to sample (Esc to cancel)' : 'Pick a color from the image'}
              onClick={togglePicking}
              aria-pressed={picking}
            >
              <EyedropperIcon />
            </button>
          )}

          <button
            type="button"
            className={styles.iconBtn}
            data-tooltip="Download"
            data-tooltip-pos="below"
            aria-label="Download"
            onClick={handleExport}
          >
            <ExportIcon />
          </button>

          <button
            type="button"
            className={`${styles.iconBtn} ${styles.iconBtnDanger}`}
            data-tooltip="Delete"
            data-tooltip-pos="below"
            aria-label="Delete"
            onClick={() => onDelete(record.id)}
          >
            <TrashIcon />
          </button>

          <span className={styles.divider} aria-hidden="true" />

          <button
            type="button"
            className={styles.iconBtn}
            data-tooltip="Close"
            data-tooltip-pos="below"
            aria-label="Close focused view"
            onClick={onBack}
          >
            <CloseIcon />
          </button>
        </div>
      </div>

      <div
        ref={stageRef}
        className={[
          styles.stage,
          zoom > 1 && styles.stageScroll,
          picking && styles.stagePicking,
        ].filter(Boolean).join(' ')}
        onContextMenu={onContextMenu}
        onClick={(e) => {
          if (picking) return;
          if (e.target.closest && e.target.closest(`.${styles.vControls}`)) return;
          if (e.target === imageRef.current) {
            const img = imageRef.current;
            const nw = img.naturalWidth;
            const nh = img.naturalHeight;
            if (nw && nh) {
              const rect = img.getBoundingClientRect();
              const elAspect = rect.width / rect.height;
              const imgAspect = nw / nh;
              let renderedW, renderedH;
              if (elAspect > imgAspect) {
                renderedH = rect.height;
                renderedW = rect.height * imgAspect;
              } else {
                renderedW = rect.width;
                renderedH = rect.width / imgAspect;
              }
              const offsetX = (rect.width - renderedW) / 2;
              const offsetY = (rect.height - renderedH) / 2;
              const x = e.clientX - rect.left;
              const y = e.clientY - rect.top;
              const onContent =
                x >= offsetX && x <= offsetX + renderedW &&
                y >= offsetY && y <= offsetY + renderedH;
              if (onContent) return;
            } else {
              return;
            }
          }
          if (e.target === videoRef.current) {
            const v = videoRef.current;
            const vw = v.videoWidth;
            const vh = v.videoHeight;
            if (vw && vh) {
              const rect = v.getBoundingClientRect();
              const elAspect = rect.width / rect.height;
              const mediaAspect = vw / vh;
              let renderedW, renderedH;
              if (elAspect > mediaAspect) {
                renderedH = rect.height;
                renderedW = rect.height * mediaAspect;
              } else {
                renderedW = rect.width;
                renderedH = rect.width / mediaAspect;
              }
              const offsetX = (rect.width - renderedW) / 2;
              const offsetY = (rect.height - renderedH) / 2;
              const x = e.clientX - rect.left;
              const y = e.clientY - rect.top;
              const onContent =
                x >= offsetX && x <= offsetX + renderedW &&
                y >= offsetY && y <= offsetY + renderedH;
              if (onContent) { toggleVideoPlay(); return; }
            } else {
              toggleVideoPlay();
              return;
            }
          }
          onBack?.();
        }}
      >
        {isTweet ? (
          <div className={styles.tweetStage}>
            <div
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
            >
              <TweetCard
                meta={tweetMeta}
                variant="focus"
                source={record.source}
                onOpenX={record.source_url
                  ? () => window.moodmark?.shell?.openUrl?.(record.source_url)
                  : undefined}
              />
            </div>
          </div>
        ) : record.kind === 'url' && record.source_url ? (
          <div
            className={styles.imageWrap}
            style={{ width: `${zoom * 100}%`, height: `${zoom * 100}%` }}
          >
            <webview
              src={record.source_url}
              partition="persist:url-view"
              allowpopups="true"
              className={styles.webview}
            />
          </div>
        ) : showVideo ? (
          <div
            className={`${styles.imageWrap} ${styles.videoStage}`}
            style={{ width: `${zoom * 100}%`, height: `${zoom * 100}%` }}
            onMouseEnter={() => setVideoHovered(true)}
            onMouseLeave={() => setVideoHovered(false)}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <video
              key={videoSrc}
              ref={videoRef}
              src={videoSrc}
              className={styles.image}
              autoPlay
              loop
              muted
              playsInline
              disablePictureInPicture
              poster={videoPoster}
              onPlay={() => setVid((s) => ({ ...s, playing: true }))}
              onPause={() => setVid((s) => ({ ...s, playing: false }))}
              onTimeUpdate={() => { const v = videoRef.current; if (v) setVid((s) => ({ ...s, current: v.currentTime })); }}
              onLoadedMetadata={() => { const v = videoRef.current; if (v) { v.muted = videoMuted; setVid((s) => ({ ...s, duration: v.duration || 0 })); } }}
              style={morphSource ? { viewTransitionName: 'morph-image' } : undefined}
            />
            <div className={styles.vControls} data-paused={!vid.playing}>
              <button type="button" className={styles.vBtn} onClick={toggleVideoPlay} aria-label={vid.playing ? 'Pause' : 'Play'}>
                {vid.playing ? <Pause size={16} strokeWidth={2} /> : <Play size={16} strokeWidth={2} />}
              </button>
              <span className={styles.vTime}>{fmtTime(vid.current)} / {fmtTime(vid.duration)}</span>
              <input
                type="range"
                className={styles.vScrub}
                min={0}
                max={1000}
                value={vid.duration ? Math.round((vid.current / vid.duration) * 1000) : 0}
                onChange={seekVideo}
                aria-label="Seek"
                style={{
                  background: `linear-gradient(to right, rgba(255,255,255,0.92) ${vid.duration ? (vid.current / vid.duration) * 100 : 0}%, rgba(255,255,255,0.22) ${vid.duration ? (vid.current / vid.duration) * 100 : 0}%)`,
                }}
              />
              <button type="button" className={styles.vBtn} onClick={toggleVideoMute} aria-label={videoMuted ? 'Unmute' : 'Mute'}>
                {videoMuted ? <VolumeX size={16} strokeWidth={2} /> : <Volume2 size={16} strokeWidth={2} />}
              </button>
            </div>
          </div>
        ) : src && (
          <div
            className={styles.imageWrap}
            style={{ width: `${zoom * 100}%`, height: `${zoom * 100}%` }}
          >
            <img
              ref={imageRef}
              src={src}
              className={styles.image}
              alt={record.title || ''}
              decoding="sync"
              draggable={!picking}
              crossOrigin="anonymous"
              style={morphSource ? { viewTransitionName: 'morph-image' } : undefined}
              onClick={handlePickerClick}
              onMouseMove={handleImageMouseMove}
              onDragStart={(e) => {
                if (picking) {
                  e.preventDefault();
                  return;
                }
                e.preventDefault();
                window.moodmark.drag.start({
                  files: [record.file_path],
                  thumbPath: record.thumb_path || record.file_path,
                });
              }}
            />
          </div>
        )}

        {(hasPrev || hasNext) && zoom <= 1 && !picking && !(record.kind === 'video' && videoHovered) && (
          <div className={styles.navHint}>
            <kbd className={styles.kbd}>&larr;</kbd>
            <kbd className={styles.kbd}>&rarr;</kbd>
            <span>to navigate</span>
          </div>
        )}
      </div>

      {picking && (loupe || justCopied) && ReactDOM.createPortal(
        <EyedropperLoupe
          loupe={loupe}
          hex={hoverHex}
          copied={justCopied}
          pos={hoverPos}
        />,
        document.body,
      )}
    </div>
  );
}
