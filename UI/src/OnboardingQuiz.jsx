import React, { useState } from 'react';

export default function OnboardingQuiz({ initialProfile, onSaveProfile }) {
  const [prefs, setPrefs] = useState({
    workMode: 'remote',
    wheelchairRamp: false,
    dedicatedElevator: false,
    adaptedRestroom: false,
    dedicatedParking: false,
    writtenCommunication: false,
    noUnannouncedCalls: false,
    lowSensoryEnvironment: false,
    screenReader: false,
    adjustableDesk: false,
    ergonomicChair: false,
    largeMonitors: false,
    otherNeeds: ''
  });

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleCheckboxChange = (e) => {
    const { name, checked } = e.target;
    setPrefs(prev => ({ ...prev, [name]: checked }));
  };

  const handleRadioChange = (mode) => {
    setPrefs(prev => ({ ...prev, workMode: mode }));
  };

  const handleTextChange = (e) => {
    setPrefs(prev => ({ ...prev, otherNeeds: e.target.value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    // Mapează opțiunile alese în structura cerută de Specificația V2
    const rawProfilePayload = {
      disabilities: `Regim de lucru preferat: ${prefs.workMode}.`,
      difficulties: [
        prefs.wheelchairRamp && "nevoie de rampă acces",
        prefs.dedicatedElevator && "nevoie de lift dedicat",
        prefs.adaptedRestroom && "nevoie de toaletă adaptată",
        prefs.dedicatedParking && "nevoie de parcare dedicată"
      ].filter(Boolean).join(", ") || "Fără restricții fizice severe.",
      requirements: [
        prefs.writtenCommunication && "comunicare predominant în scris",
        prefs.noUnannouncedCalls && "fără apeluri neanunțate",
        prefs.lowSensoryEnvironment && "mediu de lucru low-sensory",
        prefs.screenReader && "suport screen reader",
        prefs.adjustableDesk && "birou reglabil",
        prefs.ergonomicChair && "scaun ergonomic",
        prefs.largeMonitors && "monitoare mari"
      ].filter(Boolean).join(", ") || "Fără cerințe specifice.",
      extras: prefs.otherNeeds || "Niciuna"
    };

    try {
      let processedProfile;

      if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
        // Trimite mesajul SAVE_PROFILE către background.js
        processedProfile = await chrome.runtime.sendMessage({
          type: "SAVE_PROFILE",
          profile: rawProfilePayload
        });
      } else {
        // Fallback local pentru teste în browser fără extensie încărcată
        await new Promise(resolve => setTimeout(resolve, 1500));
        processedProfile = {
          needs: ["Exclusive remote work", "Screen reader support"],
          preferences: ["Flexible schedule"],
          language: "Romanian"
        };
      }

      if (onSaveProfile) {
        onSaveProfile(processedProfile);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="quiz-form">
      <div className="form-header">
        <h2>Profil Accesibilitate</h2>
        <p>Alege preferințele tale pentru o potrivire perfectă cu locurile de muncă.</p>
      </div>

      {error && (
        <div className="error-banner">
          ⚠️ Eroare la salvarea profilului: {error}
        </div>
      )}

      {/* 1. Regim de lucru */}
      <div className="section-card">
        <h3>💼 Regim de lucru</h3>
        <div className="radio-tile-group">
          <button
            type="button"
            className={`radio-tile ${prefs.workMode === 'remote' ? 'active' : ''}`}
            onClick={() => handleRadioChange('remote')}
          >
            <span className="tile-icon">🏠</span>
            <span className="tile-label">Exclusive Remote</span>
          </button>
          
          <button
            type="button"
            className={`radio-tile ${prefs.workMode === 'hybrid' ? 'active' : ''}`}
            onClick={() => handleRadioChange('hybrid')}
          >
            <span className="tile-icon">🏢</span>
            <span className="tile-label">Hybrid</span>
          </button>
          
          <button
            type="button"
            className={`radio-tile ${prefs.workMode === 'nu_conteaza' ? 'active' : ''}`}
            onClick={() => handleRadioChange('nu_conteaza')}
          >
            <span className="tile-icon">🌍</span>
            <span className="tile-label">Nu contează</span>
          </button>
        </div>
      </div>

      {/* 2. Accesibilitate la sediu */}
      <div className="section-card">
        <h3>♿ Accesibilitate la sediu fizic</h3>
        <p className="section-subtitle">Am nevoie de:</p>
        <div className="checkbox-grid">
          <label className={`custom-checkbox ${prefs.wheelchairRamp ? 'checked' : ''}`}>
            <input type="checkbox" name="wheelchairRamp" checked={prefs.wheelchairRamp} onChange={handleCheckboxChange} />
            <span className="checkbox-indicator"></span>
            <span className="checkbox-text">Rampă de acces</span>
          </label>

          <label className={`custom-checkbox ${prefs.dedicatedElevator ? 'checked' : ''}`}>
            <input type="checkbox" name="dedicatedElevator" checked={prefs.dedicatedElevator} onChange={handleCheckboxChange} />
            <span className="checkbox-indicator"></span>
            <span className="checkbox-text">Lift dedicat</span>
          </label>

          <label className={`custom-checkbox ${prefs.adaptedRestroom ? 'checked' : ''}`}>
            <input type="checkbox" name="adaptedRestroom" checked={prefs.adaptedRestroom} onChange={handleCheckboxChange} />
            <span className="checkbox-indicator"></span>
            <span className="checkbox-text">Toaletă adaptată</span>
          </label>

          <label className={`custom-checkbox ${prefs.dedicatedParking ? 'checked' : ''}`}>
            <input type="checkbox" name="dedicatedParking" checked={prefs.dedicatedParking} onChange={handleCheckboxChange} />
            <span className="checkbox-indicator"></span>
            <span className="checkbox-text">Parcare dedicată</span>
          </label>
        </div>
      </div>

      {/* 3. Comunicare */}
      <div className="section-card">
        <h3>💬 Comunicare</h3>
        <p className="section-subtitle">Canale de comunicare preferate:</p>
        <div className="checkbox-grid">
          <label className={`custom-checkbox ${prefs.writtenCommunication ? 'checked' : ''}`}>
            <input type="checkbox" name="writtenCommunication" checked={prefs.writtenCommunication} onChange={handleCheckboxChange} />
            <span className="checkbox-indicator"></span>
            <span className="checkbox-text">Comunicare predominant în scris</span>
          </label>

          <label className={`custom-checkbox ${prefs.noUnannouncedCalls ? 'checked' : ''}`}>
            <input type="checkbox" name="noUnannouncedCalls" checked={prefs.noUnannouncedCalls} onChange={handleCheckboxChange} />
            <span className="checkbox-indicator"></span>
            <span className="checkbox-text">Fără apeluri neanunțate</span>
          </label>

          <label className={`custom-checkbox ${prefs.lowSensoryEnvironment ? 'checked' : ''}`}>
            <input type="checkbox" name="lowSensoryEnvironment" checked={prefs.lowSensoryEnvironment} onChange={handleCheckboxChange} />
            <span className="checkbox-indicator"></span>
            <span className="checkbox-text">Mediu de lucru low-sensory</span>
          </label>

          <label className={`custom-checkbox ${prefs.screenReader ? 'checked' : ''}`}>
            <input type="checkbox" name="screenReader" checked={prefs.screenReader} onChange={handleCheckboxChange} />
            <span className="checkbox-indicator"></span>
            <span className="checkbox-text">Suport Screen Reader</span>
          </label>
        </div>
      </div>

      {/* 4. Ajustări specifice */}
      <div className="section-card">
        <h3>🛠️ Ajustări specifice la locul de muncă</h3>
        <p className="section-subtitle">Am nevoie de:</p>
        <div className="checkbox-grid">
          <label className={`custom-checkbox ${prefs.adjustableDesk ? 'checked' : ''}`}>
            <input type="checkbox" name="adjustableDesk" checked={prefs.adjustableDesk} onChange={handleCheckboxChange} />
            <span className="checkbox-indicator"></span>
            <span className="checkbox-text">Birou reglabil</span>
          </label>

          <label className={`custom-checkbox ${prefs.ergonomicChair ? 'checked' : ''}`}>
            <input type="checkbox" name="ergonomicChair" checked={prefs.ergonomicChair} onChange={handleCheckboxChange} />
            <span className="checkbox-indicator"></span>
            <span className="checkbox-text">Scaun ergonomic special</span>
          </label>

          <label className={`custom-checkbox ${prefs.largeMonitors ? 'checked' : ''}`}>
            <input type="checkbox" name="largeMonitors" checked={prefs.largeMonitors} onChange={handleCheckboxChange} />
            <span className="checkbox-indicator"></span>
            <span className="checkbox-text">Monitoare mari / speciale</span>
          </label>
        </div>
      </div>

      {/* 5. Alte nevoi */}
      <div className="section-card">
        <h3>📝 Alte cerințe</h3>
        <textarea
          id="otherNeeds"
          name="otherNeeds"
          rows="3"
          placeholder="Menționează orice alte nevoi specifice de accesibilitate..."
          value={prefs.otherNeeds}
          onChange={handleTextChange}
          className="styled-textarea"
        />
      </div>

      <button type="submit" className="save-btn" disabled={loading}>
        <span>{loading ? "⏳ Se generează profilul AI (20-40s)..." : "💾 Salvează Profilul"}</span>
      </button>
    </form>
  );
}