import React, { useState, useEffect } from 'react';
import OnboardingQuiz from './OnboardingQuiz';
import { MOCK_RATE_RESULT, MOCK_GUIDE_RESULT } from './mockData';
import './App.css';

// Toggle care se păstrează între deschiderile popup-ului
function usePersistentToggle(key) {
  const [value, setValue] = useState(() => {
    try { return localStorage.getItem(key) === 'true'; } catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem(key, String(value)); } catch { /* storage indisponibil */ }
  }, [key, value]);
  return [value, setValue];
}

// Clasa de culoare pentru bannerul de scor (definită în App.css)
function ratingClass(rating) {
  if (!rating) return 'UNRATED';
  if (rating >= 7) return 'COMPATIBLE';
  if (rating >= 4) return 'PARTIAL_MATCH';
  return 'INCOMPATIBLE';
}

export default function App() {
  const [highContrast, setHighContrast] = usePersistentToggle('axios.highContrast');
  const [dyslexiaFont, setDyslexiaFont] = usePersistentToggle('axios.dyslexiaFont');
  const [activeTab, setActiveTab] = useState('preferences'); // 'preferences', 'analysis', 'guide'

  const [savedProfile, setSavedProfile] = useState(null);
  const [jobData, setJobData] = useState(null);
  const [analysis, setAnalysis] = useState(null);
  const [guide, setGuide] = useState(null);

  const [loading, setLoading] = useState(false);
  const [loadingText, setLoadingText] = useState('');
  const [error, setError] = useState(null);

  // 1. La deschiderea Popup-ului: încarcă profilul și datele jobului curent
  useEffect(() => {
    async function init() {
      if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
        try {
          // A. Obține profilul procesat salvat
          const profile = await chrome.runtime.sendMessage({ type: "GET_PROFILE" });
          if (profile) {
            setSavedProfile(profile);
            setActiveTab('analysis'); // Mergem direct pe Analiză dacă profilul există
          }

          // B. Obține datele jobului din pagina activă via Content Script
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (tab?.id) {
            const job = await chrome.tabs.sendMessage(tab.id, { type: "GET_JOB_DATA" });
            setJobData(job);
            
            // Dacă avem profil, rulăm automat analiza jobului
            if (profile && job) {
              fetchJobAnalysis(job);
            }
          }
        } catch (err) {
          console.log("Pagina activă nu poate fi citită sau extensia rulează în modul Dev:", err);
        }
      } else {
        // Fallback pentru modul dev pe localhost:5173
        setAnalysis(MOCK_RATE_RESULT);
        setGuide(MOCK_GUIDE_RESULT);
      }
    }

    init();
  }, []);

  // 2. Cere Analiza de Compatibilitate (RATE_JOB)
  const fetchJobAnalysis = async (jobToAnalyze = jobData) => {
    if (!jobToAnalyze) return;
    setLoading(true);
    setLoadingText('AI-ul evaluează potrivirea jobului (20–40 secunde)...');
    setError(null);

    try {
      if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
        const result = await chrome.runtime.sendMessage({
          type: "RATE_JOB",
          job: jobToAnalyze
        });
        setAnalysis(result);
      } else {
        await new Promise(r => setTimeout(r, 1000));
        setAnalysis(MOCK_RATE_RESULT);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  // 3. Cere Ghidul de Aplicare (GUIDE_JOB)
  const fetchApplicationGuide = async () => {
    if (!jobData) return;
    setLoading(true);
    setLoadingText('Se generează ghidul de interviu și aplicare (20–40 secunde)...');
    setError(null);

    try {
      if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
        const result = await chrome.runtime.sendMessage({
          type: "GUIDE_JOB",
          job: jobData
        });
        setGuide(result);
        setActiveTab('guide');
      } else {
        await new Promise(r => setTimeout(r, 1000));
        setGuide(MOCK_GUIDE_RESULT);
        setActiveTab('guide');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleProfileSaved = (newProfile) => {
    setSavedProfile(newProfile);
    setActiveTab('analysis');
    if (jobData) {
      fetchJobAnalysis(jobData);
    }
  };

  return (
    <div className={`app-wrapper ${highContrast ? 'high-contrast' : ''} ${dyslexiaFont ? 'dyslexia-font' : ''}`}>
      <header className="app-header">
        <div className="logo-container">
          <div className="logo-icon">⚡</div>
          <div>
            <h1>Axios UI</h1>
            <span className="subtitle-tag">Accessibility Assistant</span>
          </div>
        </div>
        <div className="header-toggles">
          <button
            onClick={() => setDyslexiaFont(!dyslexiaFont)}
            className="contrast-toggle-btn"
            aria-pressed={dyslexiaFont}
            aria-label="Comută fontul pentru dislexie"
          >
            {dyslexiaFont ? '🔤 Font Standard' : '🔤 Font Dislexie'}
          </button>
          <button
            onClick={() => setHighContrast(!highContrast)}
            className="contrast-toggle-btn"
            aria-pressed={highContrast}
            aria-label="Comută modul High Contrast"
          >
            {highContrast ? '☀️ Normal' : '👁️ High Contrast'}
          </button>
        </div>
      </header>

      {/* Navigare Tab-uri */}
      <nav className="tabs-nav" aria-label="Meniu Navigare">
        <button 
          className={`tab-btn ${activeTab === 'preferences' ? 'active' : ''}`} 
          onClick={() => setActiveTab('preferences')}
        >
          ⚙️ Setări Profil
        </button>
        <button 
          className={`tab-btn ${activeTab === 'analysis' ? 'active' : ''}`} 
          onClick={() => setActiveTab('analysis')}
        >
          📊 Analiză Job
        </button>
        {guide && (
          <button 
            className={`tab-btn ${activeTab === 'guide' ? 'active' : ''}`} 
            onClick={() => setActiveTab('guide')}
          >
            🚀 Ghid Aplicare
          </button>
        )}
      </nav>

      <main className="content-area">
        {error && (
          <div className="error-banner">
            ❌ {error}
          </div>
        )}

        {loading ? (
          <div className="section-card loading-card">
            <div className="spinner"></div>
            <h3>Se procesează cererea...</h3>
            <p>{loadingText}</p>
          </div>
        ) : (
          <>
            {/* TAB 1: Formulár Profil */}
            {activeTab === 'preferences' && (
              <div>
                {savedProfile && (
                  <div className="section-card active-profile-summary">
                    <h3>✅ Profil AI Salvat</h3>
                    <p><strong>Nevoie principale:</strong> {savedProfile.needs?.join(", ") || "Fără"}</p>
                    <p><strong>Preferințe:</strong> {savedProfile.preferences?.join(", ") || "Fără"}</p>
                  </div>
                )}
                <OnboardingQuiz 
                  initialProfile={savedProfile} 
                  onSaveProfile={handleProfileSaved} 
                />
              </div>
            )}

            {/* TAB 2: Analiză Job (RATE_JOB) */}
            {activeTab === 'analysis' && (
              <div className="analysis-view">
                {!savedProfile ? (
                  <div className="section-card info-card">
                    <h3>⚠️ Niciun profil configurat</h3>
                    <p>Completează mai întâi profilul tău de accesibilitate pentru a putea analiza anunțurile de job.</p>
                    <button className="primary-btn" onClick={() => setActiveTab('preferences')}>
                      Creează Profil
                    </button>
                  </div>
                ) : analysis ? (
                  <>
                    {/* Score Banner */}
                    <div className={`match-banner ${ratingClass(analysis.rating)}`}>
                      <div className="match-info">
                        <span className="match-title">Scor Potrivire Accesibilitate</span>
                        <span className="match-status">
                          {analysis.rating ? `Scor: ${analysis.rating} / 10` : 'Scor Nedeterminat'}
                        </span>
                      </div>
                      <div className="match-score-circle">
                        <span>{analysis.rating ? `${analysis.rating * 10}%` : 'N/A'}</span>
                      </div>
                    </div>

                    {/* Explicație Scor */}
                    <div className="section-card">
                      <h3>💡 De ce acest scor?</h3>
                      <p>{analysis.rating_explanation}</p>
                    </div>

                    {/* Avertisment Anunț Vag */}
                    {analysis.vague && (
                      <div className="section-card warning-card">
                        <h3>⚠️ Anunț Incomplet / Vag</h3>
                        <ul className="questions-list">
                          {analysis.vague_details?.map((v, i) => (
                            <li key={i}>🔸 {v}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Condiții de Lucru */}
                    {analysis.work_conditions?.length > 0 && (
                      <div className="section-card">
                        <h3>🏢 Condiții de Lucru Detectate</h3>
                        <div className="findings-grid">
                          {analysis.work_conditions.map((item, idx) => (
                            <div className="finding-card" key={idx}>
                              <div className="finding-header">
                                <span className="finding-criterion">{item.condition}</span>
                                <span className={`finding-status ${item.source}`}>
                                  {item.source === 'stated' ? 'Menționat' : 'Inferat'}
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Compatibilități și Conflicte */}
                    {analysis.compatible_with_needs?.length > 0 && (
                      <div className="section-card">
                        <h3 style={{ color: '#16a34a' }}>✅ Cerințe Îndeplinite</h3>
                        <ul className="questions-list">
                          {analysis.compatible_with_needs.map((item, i) => <li key={i}>✓ {item}</li>)}
                        </ul>
                      </div>
                    )}

                    {analysis.conflicts_with_needs?.length > 0 && (
                      <div className="section-card">
                        <h3 style={{ color: '#dc2626' }}>❌ Conflicte Detectate</h3>
                        <ul className="questions-list">
                          {analysis.conflicts_with_needs.map((item, i) => <li key={i}>✕ {item}</li>)}
                        </ul>
                      </div>
                    )}

                    {/* Buton Generare Ghid */}
                    <button className="primary-btn guide-trigger-btn" onClick={fetchApplicationGuide}>
                      🚀 Generează Ghid de Aplicare & Interviu
                    </button>
                  </>
                ) : (
                  <div className="section-card">
                    <p>Nu s-a putut încărca analiza pentru acest job.</p>
                    <button className="primary-btn" onClick={() => fetchJobAnalysis()}>Reîncearcă Analiza</button>
                  </div>
                )}
              </div>
            )}

            {/* TAB 3: Ghid Aplicare (GUIDE_JOB) */}
            {activeTab === 'guide' && guide && (
              <div className="guide-view">
                <div className="section-card">
                  <h3>📋 Pași de Aplicare</h3>
                  <ol className="steps-list">
                    {guide.application_steps?.map((step, idx) => (
                      <li key={idx}>{step}</li>
                    ))}
                  </ol>
                </div>

                <div className="section-card">
                  <h3>👔 Ținută Recomandată</h3>
                  <p>{guide.attire}</p>
                </div>

                {guide.documents_to_prepare?.length > 0 && (
                  <div className="section-card">
                    <h3>📁 Documente de Pregătit</h3>
                    <ul className="questions-list">
                      {guide.documents_to_prepare.map((doc, idx) => <li key={idx}>📄 {doc}</li>)}
                    </ul>
                  </div>
                )}

                {guide.questions_to_ask_employer?.length > 0 && (
                  <div className="section-card">
                    <h3>❓ Întrebări de pus Angajatorului</h3>
                    <ul className="questions-list">
                      {guide.questions_to_ask_employer.map((q, idx) => <li key={idx}>👉 {q}</li>)}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}