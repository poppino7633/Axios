import React, { useState, useEffect } from 'react'
import OnboardingQuiz from './OnboardingQuiz'
import { MOCK_ANALYSIS_RESULT } from './mockData'
import './App.css'

export default function App() {
  const [highContrast, setHighContrast] = useState(false);
  const [activeTab, setActiveTab] = useState('preferences');
  const [analysis, setAnalysis] = useState(MOCK_ANALYSIS_RESULT);

  useEffect(() => {
    if (typeof chrome !== 'undefined' && chrome.runtime) {
      const listener = (message) => {
        if (message.action === 'NEW_ANALYSIS_RESULT') {
          setAnalysis(message.data);
        }
      };
      chrome.runtime.onMessage.addListener(listener);
      return () => chrome.runtime.onMessage.removeListener(listener);
    }
  }, []);

  return (
    <div className={`app-container ${highContrast ? 'high-contrast' : ''}`}>
      <header>
        <h1>Axios Assistant</h1>
        <button 
          onClick={() => setHighContrast(!highContrast)} 
          className="contrast-btn"
          aria-label="Comută modul High Contrast"
        >
          👁️ High Contrast
        </button>
      </header>

      <nav className="tab-nav" aria-label="Meniu principal">
        <button 
          className={activeTab === 'preferences' ? 'active' : ''} 
          onClick={() => setActiveTab('preferences')}
        >
          Setări Profil
        </button>
        <button 
          className={activeTab === 'analysis' ? 'active' : ''} 
          onClick={() => setActiveTab('analysis')}
        >
          Analiză Job
        </button>
      </nav>

      <main aria-live="polite">
        {activeTab === 'preferences' ? (
          <OnboardingQuiz onSave={() => setActiveTab('analysis')} />
        ) : (
          <section className="analysis-section">
            <div className={`status-badge ${analysis.overallMatch}`}>
              <span>Match: {analysis.overallMatch.replace('_', ' ')}</span>
              <strong>{analysis.scorePercentage}%</strong>
            </div>

            <h2>Constatări & Dovezi</h2>
            <ul className="findings-list">
              {analysis.findings.map((item, idx) => (
                <li key={idx}>
                  <strong>{item.criterion}:</strong> {item.explanation}
                  {item.evidence && <blockquote>"{item.evidence}"</blockquote>}
                </li>
              ))}
            </ul>

            <h2>Întrebări utile pentru interviu</h2>
            <ul>
              {analysis.employerQuestions.map((q, idx) => (
                <li key={idx}>{q}</li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </div>
  );
}