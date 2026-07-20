export function tweetMediaItems(record, tweetMeta) {
  const list = Array.isArray(tweetMeta?.media) ? tweetMeta.media : null;
  if (list && list.length) {
    return list.map((m, i) => {
      if (m && m.type === 'video') {
        const primaryLocal = i === 0 && record?.kind === 'video';
        return {
          type: 'video',
          url: primaryLocal ? null : (m.url || null),
          poster: m.poster || null,
          primaryLocal,
        };
      }
      const primary = i === 0 && record?.kind !== 'video';
      return { type: 'image', url: (m && m.url) || '', primary };
    });
  }

  const urls = Array.isArray(tweetMeta?.imageUrls) ? tweetMeta.imageUrls : [];
  if (record?.kind === 'video') {
    return [{ type: 'video', primaryLocal: true }, ...urls.map((url) => ({ type: 'image', url }))];
  }
  return urls.map((url, i) => ({ type: 'image', url, primary: i === 0 }));
}

export function twimgLarge(url) {
  try {
    const u = new URL(url);
    if (!/(^|\.)twimg\.com$/i.test(u.hostname)) return url;
    u.searchParams.set('name', 'large');
    return u.toString();
  } catch {
    return url;
  }
}
