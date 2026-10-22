import React, { useEffect, useState } from 'react';
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { STARTER_HOMEPAGE_SECTIONS } from '../components/homepageSectionsConfig';
import './AdminHomepageSections.css';

const TYPES = [
  ['price_range', 'Price range (Under ₹9 / ₹49 / ₹99)'],
  ['tag', 'Tags / Festival / Sale'],
  ['category', 'Category'],
  ['featured', 'Manually curated products'],
  ['new_arrivals', 'New arrivals'],
  ['best_sellers', 'Best sellers (requires sales fields)'],
];
const SORTS = [
  ['discount-desc', 'Highest discount first'],
  ['price-asc', 'Price: low to high'],
  ['price-desc', 'Price: high to low'],
  ['newest', 'Newest first'],
];
const emptySection = () => ({
  id: `section-${Date.now().toString(36)}`, title: 'New collection', subtitle: 'Discover something special.',
  type: 'tag', active: true, sortOrder: 99, productLimit: 10, tags: [], productIds: [],
  minPrice: 0, maxPrice: 99, matchMode: 'any', sortBy: 'discount-desc', showViewAll: true,
  hideWhenEmpty: true, badge: 'CURATED FOR YOU', accent: 'gold',
});
const toLines = (value) => Array.isArray(value) ? value.join('\n') : '';
const fromLines = (value) => String(value || '').split(/[\n,]/).map((x) => x.trim()).filter(Boolean);

export default function AdminHomepageSections() {
  const [sections, setSections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    getDoc(doc(db, 'homepageConfig', 'sections'))
      .then((snap) => {
        if (!alive) return;
        const saved = snap.exists() ? snap.data().sections : null;
        setSections(Array.isArray(saved) ? saved : STARTER_HOMEPAGE_SECTIONS.map((s) => ({ ...s })));
      })
      .catch((e) => {
        console.error('Could not load homepage section configuration', e);
        if (alive) {
          setSections(STARTER_HOMEPAGE_SECTIONS.map((s) => ({ ...s })));
          setError('Could not read homepageConfig/sections. Check Firestore rules. Starter sections are loaded locally.');
        }
      })
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, []);

  const updateSection = (id, patch) => setSections((current) => current.map((s) => s.id === id ? { ...s, ...patch } : s));
  const removeSection = (id) => setSections((current) => current.filter((s) => s.id !== id));
  const moveSection = (index, direction) => {
    setSections((current) => {
      const next = [...current];
      const target = index + direction;
      if (target < 0 || target >= next.length) return current;
      [next[index], next[target]] = [next[target], next[index]];
      return next.map((s, i) => ({ ...s, sortOrder: i + 1 }));
    });
  };

  const save = async () => {
    setSaving(true); setNotice(''); setError('');
    try {
      const normalized = sections.map((s, i) => ({
        ...s,
        id: String(s.id || `section-${i + 1}`).trim().replace(/\s+/g, '-').toLowerCase(),
        title: String(s.title || '').trim() || 'Untitled section',
        sortOrder: i + 1,
        productLimit: Math.max(1, Math.min(30, Number(s.productLimit) || 10)),
        minPrice: s.minPrice === '' || s.minPrice == null ? 0 : Number(s.minPrice),
        maxPrice: s.maxPrice === '' || s.maxPrice == null ? 999999 : Number(s.maxPrice),
        tags: Array.isArray(s.tags) ? s.tags : [],
        productIds: Array.isArray(s.productIds) ? s.productIds : [],
      }));
      const ids = normalized.map((s) => s.id);
      if (new Set(ids).size !== ids.length) throw new Error('Each section must have a unique ID.');
      await setDoc(doc(db, 'homepageConfig', 'sections'), {
        sections: normalized,
        updatedAt: serverTimestamp(),
        schemaVersion: 1,
      });
      setSections(normalized);
      setNotice('Homepage sections saved. Refresh the homepage to see the new layout.');
    } catch (e) {
      console.error(e);
      setError(e.message || 'Could not save sections. Check your Firestore permissions.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="tanishka-admin-home"><div className="tanishka-admin-home__loading">Loading homepage layout…</div></div>;

  return (
    <main className="tanishka-admin-home">
      <header className="tanishka-admin-home__header">
        <div>
          <span className="tanishka-admin-home__eyebrow">TANISHKA STOREFRONT</span>
          <h1>Homepage sections</h1>
          <p>Arrange campaigns, set budgets, curate festival tags, and control what customers see.</p>
        </div>
        <div className="tanishka-admin-home__header-actions">
          <button type="button" className="tanishka-admin-home__secondary" onClick={() => setSections(STARTER_HOMEPAGE_SECTIONS.map((s) => ({ ...s })))}>Restore starter layout</button>
          <button type="button" className="tanishka-admin-home__save" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save homepage'}</button>
        </div>
      </header>

      {notice && <div className="tanishka-admin-home__message is-success" role="status">{notice}</div>}
      {error && <div className="tanishka-admin-home__message is-error" role="alert">{error}</div>}

      <div className="tanishka-admin-home__tip"><strong>How it works:</strong> price sections filter by customer-visible product price; tag sections match your product tags; featured sections can use Firestore product IDs. Each section shows up to 10 products by default.</div>

      <div className="tanishka-admin-home__list">
        {sections.map((section, index) => (
          <section className={`tanishka-admin-section ${section.active ? '' : 'is-disabled'}`} key={section.id}>
            <div className="tanishka-admin-section__top">
              <div className="tanishka-admin-section__position">{String(index + 1).padStart(2, '0')}</div>
              <div className="tanishka-admin-section__top-title"><strong>{section.title || 'Untitled section'}</strong><small>{section.type.replaceAll('_', ' ')} · {section.productLimit || 10} products</small></div>
              <label className="tanishka-admin-toggle"><input type="checkbox" checked={section.active !== false} onChange={(e) => updateSection(section.id, { active: e.target.checked })} /><span>{section.active !== false ? 'Active' : 'Hidden'}</span></label>
              <div className="tanishka-admin-section__order">
                <button type="button" aria-label="Move section up" disabled={index === 0} onClick={() => moveSection(index, -1)}>↑</button>
                <button type="button" aria-label="Move section down" disabled={index === sections.length - 1} onClick={() => moveSection(index, 1)}>↓</button>
              </div>
            </div>
            <div className="tanishka-admin-section__fields">
              <label>Section title<input value={section.title || ''} onChange={(e) => updateSection(section.id, { title: e.target.value })} placeholder="Under ₹99" /></label>
              <label>Section ID<input value={section.id || ''} onChange={(e) => updateSection(section.id, { id: e.target.value })} placeholder="under-99" /></label>
              <label className="span-2">Subtitle<input value={section.subtitle || ''} onChange={(e) => updateSection(section.id, { subtitle: e.target.value })} placeholder="Great finds, even better prices." /></label>
              <label>Section type<select value={section.type} onChange={(e) => updateSection(section.id, { type: e.target.value })}>{TYPES.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
              <label>Products to show<input type="number" min="1" max="30" value={section.productLimit ?? 10} onChange={(e) => updateSection(section.id, { productLimit: e.target.value })} /></label>
              {section.type === 'price_range' && <>
                <label>Minimum price (₹)<input type="number" min="0" value={section.minPrice ?? 0} onChange={(e) => updateSection(section.id, { minPrice: e.target.value })} /></label>
                <label>Maximum price (₹)<input type="number" min="0" value={section.maxPrice ?? 99} onChange={(e) => updateSection(section.id, { maxPrice: e.target.value })} /></label>
              </>}
              {section.type === 'tag' && <>
                <label className="span-2">Tags (one per line or comma-separated)<textarea rows="3" value={toLines(section.tags)} onChange={(e) => updateSection(section.id, { tags: fromLines(e.target.value) })} placeholder={'Navratri\nFF Sale\ncollection_mega_savings'} /></label>
                <label>Tag matching<select value={section.matchMode || 'any'} onChange={(e) => updateSection(section.id, { matchMode: e.target.value })}><option value="any">Match any tag</option><option value="all">Require all tags</option></select></label>
                <label className="span-2">Optional manually curated product IDs (combined with tag matches)<textarea rows="3" value={toLines(section.productIds)} onChange={(e) => updateSection(section.id, { productIds: fromLines(e.target.value) })} placeholder="Paste product document IDs, one per line" /></label>
              </>}
              {section.type === 'category' && <label>Category name<input value={section.category || ''} onChange={(e) => updateSection(section.id, { category: e.target.value })} placeholder="Beauty, Health & Care" /></label>}
              {section.type === 'featured' && <label className="span-2">Product document IDs (one per line)<textarea rows="3" value={toLines(section.productIds)} onChange={(e) => updateSection(section.id, { productIds: fromLines(e.target.value) })} placeholder="Paste Firestore product document IDs" /></label>}
              <label>Sort products<select value={section.sortBy || 'discount-desc'} onChange={(e) => updateSection(section.id, { sortBy: e.target.value })}>{SORTS.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
              <label>Eyebrow / badge<input value={section.badge || ''} onChange={(e) => updateSection(section.id, { badge: e.target.value })} placeholder="HOT DEALS" /></label>
              <label>Accent theme<select value={section.accent || 'gold'} onChange={(e) => updateSection(section.id, { accent: e.target.value })}><option value="gold">Antique gold</option><option value="maroon">Deep maroon</option></select></label>
              <div className="tanishka-admin-section__checks span-2">
                <label><input type="checkbox" checked={section.showViewAll !== false} onChange={(e) => updateSection(section.id, { showViewAll: e.target.checked })} /> Show “View all”</label>
                <label><input type="checkbox" checked={section.hideWhenEmpty !== false} onChange={(e) => updateSection(section.id, { hideWhenEmpty: e.target.checked })} /> Hide if no products match</label>
              </div>
            </div>
            <div className="tanishka-admin-section__footer"><span>Section ID: <code>{section.id}</code></span><button type="button" className="tanishka-admin-section__delete" onClick={() => removeSection(section.id)}>Remove section</button></div>
          </section>
        ))}
      </div>

      <div className="tanishka-admin-home__bottom-actions">
        <button type="button" className="tanishka-admin-home__add" onClick={() => setSections((current) => [...current, { ...emptySection(), sortOrder: current.length + 1 }])}>＋ Add section</button>
        <button type="button" className="tanishka-admin-home__save" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save homepage layout'}</button>
      </div>
      <p className="tanishka-admin-home__security-note">Protect this route with your existing admin authentication and restrict writes to <code>homepageConfig/sections</code> in Firestore Security Rules. Do not leave this page publicly writable.</p>
    </main>
  );
}
