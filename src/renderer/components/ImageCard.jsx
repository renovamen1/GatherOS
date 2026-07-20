import React, { memo, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import styles from './ImageCard.module.css';
import { fileUrl } from '../lib/fileUrl.js';
import { tweetMediaItems, twimgLarge } from '../lib/tweetMedia.js';
import TweetCard from './TweetCard.jsx';

function VideoIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5" />
      <rect x="2" y="6" width="14" height="12" rx="2" />
    </svg>
  );
}

function XGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="10" height="10" fill="currentColor" aria-hidden="true">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24h-6.66l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231 5.45-6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 14 14" width="11" height="11" aria-hidden="true">
      <path
        d="M3 7.2 L6 10 L11 4"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PeekIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 6 V3 H6" />
      <path d="M13 6 V3 H10" />
      <path d="M3 10 V13 H6" />
      <path d="M13 10 V13 H10" />
    </svg>
  );
}

function ChevronLeftIcon() {
  return (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg>
  );
}
function ChevronRightIcon() {
  return (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6" /></svg>
  );
}

function ImageCard({
  record,
  columns = 4,
  selected,
  selectionActive,
  highlighted = false,
  onSelect,
  onOpen,
  onContextMenu,
  onDragStart,
  onHover,
  onForceClick,
  fresh,
  staggerMs = 0,
  morphSource = false,
}) {
  const src = fileUrl(record.file_path);
  const isAnimated = /\.gif$/i.test(record.file_path || '');
  const maxEdge = Math.max(record.width || 0, record.height || 0);
  const useThumbInGrid = record.thumb_path && !isAnimated
    && (columns >= 7 || maxEdge > 3000);
  const gridImgSrc = useThumbInGrid ? fileUrl(record.thumb_path) : src;
  const aspect =
    record.width && record.height ? record.width / record.height : 4 / 3;

  const tweetMeta = (() => {
    if (!record.tweet_meta) return null;
    try { return JSON.parse(record.tweet_meta); }
    catch { return null; }
  })();
  const isTweet = record.kind === 'tweet' && !!tweetMeta;
  const articleMeta = (!isTweet && tweetMeta?.article?.title)
    ? tweetMeta.article
    : null;

  const media = tweetMediaItems(record, tweetMeta);
  const canPageImages = !isTweet && media.length > 1;
  const [imgIdx, setImgIdx] = useState(0);
  useEffect(() => { setImgIdx(0); }, [record.id]);
  const activeMedia = media.length > 0 ? media[Math.min(imgIdx, media.length - 1)] : null;
  const showVideo = activeMedia ? activeMedia.type === 'video' : record.kind === 'video';
  const localVideo = !activeMedia || activeMedia.primaryLocal || !activeMedia.url;
  const videoSrc = showVideo
    ? (localVideo ? src : activeMedia.url)
    : src;
  const videoPoster = (showVideo && !localVideo && activeMedia.poster)
    ? activeMedia.poster
    : (record.thumb_path ? fileUrl(record.thumb_path) : undefined);
  const displaySrc = (activeMedia && activeMedia.type === 'image')
    ? (activeMedia.primary ? gridImgSrc : twimgLarge(activeMedia.url))
    : gridImgSrc;
  const peekSrc = showVideo
    ? (!localVideo && activeMedia.poster ? activeMedia.poster : fileUrl(record.thumb_path || record.file_path))
    : displaySrc;
  const pageImage = (delta) => (e) => {
    e.preventDefault();
    e.stopPropagation();
    const n = media.length;
    if (n > 1) setImgIdx((i) => ((i + delta) % n + n) % n);
  };
  const stopArrow = (e) => { e.stopPropagation(); e.preventDefault(); };
  const pagePreloadedRef = useRef(false);
  const preloadPagedImages = () => {
    if (pagePreloadedRef.current || !canPageImages) return;
    pagePreloadedRef.current = true;
    for (const m of media) {
      if (m.type === 'image' && !m.primary) {
        const im = new Image();
        im.decoding = 'async';
        im.src = twimgLarge(m.url);
      }
    }
  };

  const pressPosRef = useRef(null);
  const movedSincePress = (e) => {
    const p = pressPosRef.current;
    if (!p) return false;
    return Math.abs(e.clientX - p.x) + Math.abs(e.clientY - p.y) > 6;
  };

  const [enteredFresh] = useState(() => !!fresh);

  const OPEN_DELAY = 220;
  const CLOSE_GRACE = 150;
  const [peeking, setPeeking] = useState(false);
  const openTimerRef = useRef(null);
  const closeTimerRef = useRef(null);

  const cancelOpen = () => {
    if (openTimerRef.current) {
      clearTimeout(openTimerRef.current);
      openTimerRef.current = null;
    }
  };
  const scheduleOpen = () => {
    cancelOpen();
    openTimerRef.current = setTimeout(() => {
      openTimerRef.current = null;
      setPeeking(true);
    }, OPEN_DELAY);
  };
  const cancelClose = () => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  };
  const scheduleClose = (delay) => {
    cancelClose();
    closeTimerRef.current = setTimeout(() => {
      setPeeking(false);
      closeTimerRef.current = null;
    }, delay);
  };

  useEffect(() => () => { cancelOpen(); cancelClose(); }, []);

  useEffect(() => {
    const el = wrapperRef.current;
    if (!el || !onForceClick) return undefined;
    const handler = (e) => {
      e.preventDefault();
      onForceClick(record.id);
    };
    el.addEventListener('webkitmouseforceclick', handler);
    return () => el.removeEventListener('webkitmouseforceclick', handler);
  }, [onForceClick, record.id]);

  const wrapperRef = useRef(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setInView(true);
      return undefined;
    }
    const obs = new IntersectionObserver((entries) => {
      setInView(entries[entries.length - 1].isIntersecting);
    }, { rootMargin: '1000px 0px' });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const [videoHover, setVideoHover] = useState(false);
  const gridVideoRef = useRef(null);
  useEffect(() => {
    const v = gridVideoRef.current;
    if (!v || !showVideo) return undefined;
    if (videoHover) {
      const p = v.play();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } else {
      try { v.pause(); v.currentTime = 0; } catch { /* ignore */ }
    }
    return undefined;
  }, [videoHover, showVideo, videoSrc]);

  const [springback, setSpringback] = useState(false);
  const springTimerRef = useRef(null);
  const selectArmRef = useRef(null);
  const clearSelectArm = () => {
    if (selectArmRef.current) {
      clearTimeout(selectArmRef.current);
      selectArmRef.current = null;
    }
  };
  useEffect(() => () => {
    if (springTimerRef.current) clearTimeout(springTimerRef.current);
    if (selectArmRef.current) clearTimeout(selectArmRef.current);
  }, []);

  return (
    <button
      ref={wrapperRef}
      type="button"
      data-save-id={record.id}
      data-save-title={record.title || undefined}
      draggable={!!onDragStart}
      className={[
        styles.card,
        selected && styles.selected,
        highlighted && styles.highlight,
        selectionActive && styles.showSelectables,
        enteredFresh && styles.fresh,
        springback && styles.springback,
      ].filter(Boolean).join(' ')}
      style={staggerMs ? { '--card-stagger': `${staggerMs}ms` } : undefined}
      onClick={(e) => {
        if (isTweet && movedSincePress(e)) return;
        onSelect(record.id, e.metaKey || e.ctrlKey || e.shiftKey);
      }}
      onDoubleClick={() => onOpen(record)}
      onMouseEnter={() => { onHover?.(record.id); preloadPagedImages(); }}
      onMouseLeave={() => { clearSelectArm(); onHover?.(null, record.id); }}
      onContextMenu={(e) => {
        if (onContextMenu) {
          e.preventDefault();
          onContextMenu(record.id, e.clientX, e.clientY);
        }
      }}
      onMouseDown={(e) => {
        pressPosRef.current = { x: e.clientX, y: e.clientY };
        clearSelectArm();
        const el = wrapperRef.current;
        if (!el) return;
        el.draggable = !!onDragStart;
        if (isTweet && onDragStart && e.target.closest('[data-tweet-selectable]')) {
          selectArmRef.current = setTimeout(() => {
            if (wrapperRef.current) wrapperRef.current.draggable = false;
          }, 200);
        }
      }}
      onMouseUp={clearSelectArm}
      onDragStart={(e) => {
        if (!onDragStart) return;
        clearSelectArm();
        onDragStart(e, record);
      }}
      onDragEnd={(e) => {
        if (e.dataTransfer?.dropEffect === 'none') {
          setSpringback(true);
          if (springTimerRef.current) clearTimeout(springTimerRef.current);
          springTimerRef.current = setTimeout(() => setSpringback(false), 360);
        }
      }}
    >
      <div
        className={`${styles.frame}${isTweet ? ` ${styles.frameTweet}` : ''}`}
        style={isTweet ? undefined : { aspectRatio: aspect }}
        onPointerEnter={() => { if (showVideo) setVideoHover(true); }}
        onPointerLeave={() => { if (showVideo) setVideoHover(false); }}
      >
        {isTweet ? (
          <TweetCard meta={tweetMeta} variant="grid" source={record.source} />
        ) : inView && (showVideo ? (
          <video
            key={videoSrc}
            ref={gridVideoRef}
            src={videoSrc}
            poster={videoPoster}
            className={styles.image}
            muted
            loop
            playsInline
            preload="metadata"
            draggable={false}
            style={morphSource ? { viewTransitionName: 'morph-image' } : undefined}
          />
        ) : src && (
          <img
            src={displaySrc}
            className={styles.image}
            alt={record.title || ''}
            loading="lazy"
            decoding="async"
            draggable={false}
            style={morphSource ? { viewTransitionName: 'morph-image' } : undefined}
          />
        ))}
        {articleMeta && (
          <div className={styles.articleOverlay}>
            <span className={styles.articleBadge}>
              <XGlyph />
              Article
            </span>
            <span className={styles.articleTitle}>{articleMeta.title}</span>
            {articleMeta.excerpt && (
              <span className={styles.articleExcerpt}>{articleMeta.excerpt}</span>
            )}
          </div>
        )}
        {inView && showVideo && !canPageImages && !videoHover && (
          <span className={styles.videoBadge} aria-label="Video">
            <VideoIcon />
          </span>
        )}
        {inView && canPageImages && (
          <span className={styles.countBadge} aria-label={`${imgIdx + 1} of ${media.length}`}>
            {canPageImages && (
              <span
                className={`${styles.countArrow} ${styles.countArrowPrev}`}
                role="button"
                aria-label="Previous image"
                onClick={pageImage(-1)}
                onDoubleClick={stopArrow}
                onMouseDown={stopArrow}
                onPointerDown={stopArrow}
              >
                <ChevronLeftIcon />
              </span>
            )}
            <span className={styles.countMain}>{imgIdx + 1}/{media.length}</span>
            {canPageImages && (
              <span
                className={`${styles.countArrow} ${styles.countArrowNext}`}
                role="button"
                aria-label="Next image"
                onClick={pageImage(1)}
                onDoubleClick={stopArrow}
                onMouseDown={stopArrow}
                onPointerDown={stopArrow}
              >
                <ChevronRightIcon />
              </span>
            )}
          </span>
        )}
        {inView && (
          <>
            <span
              role="checkbox"
              aria-checked={!!selected}
              tabIndex={-1}
              className={`${styles.checkbox} ${selected ? styles.checkboxOn : ''}`}
              onClick={(e) => {
                e.stopPropagation();
                onSelect(record.id, true);
              }}
              title={selected ? 'Deselect' : 'Select'}
            >
              {selected && <CheckIcon />}
            </span>
            {!isTweet && (
              <span
                className={styles.peekBtn}
                title="Peek"
                aria-label="Peek"
                onClick={(e) => e.stopPropagation()}
                onMouseEnter={() => {
                  cancelClose();
                  if (peeking) return;
                  scheduleOpen();
                }}
                onMouseLeave={() => {
                  cancelOpen();
                  if (peeking) scheduleClose(CLOSE_GRACE);
                }}
              >
                <PeekIcon />
              </span>
            )}
          </>
        )}
      </div>

      {peeking && peekSrc && createPortal(
        <div
          className={styles.lightbox}
          aria-hidden="true"
        >
          {showVideo ? (
            <video
              src={fileUrl(record.file_path)}
              poster={record.thumb_path ? fileUrl(record.thumb_path) : undefined}
              className={styles.lightboxImage}
              autoPlay
              muted
              loop
              playsInline
              controls={false}
              onMouseEnter={cancelClose}
              onMouseLeave={() => setPeeking(false)}
              draggable={false}
            />
          ) : (
            <img
              src={peekSrc}
              alt=""
              className={styles.lightboxImage}
              decoding="async"
              onMouseEnter={cancelClose}
              onMouseLeave={() => setPeeking(false)}
              draggable={false}
            />
          )}
        </div>,
        document.body,
      )}
    </button>
  );
}

export default memo(ImageCard);
