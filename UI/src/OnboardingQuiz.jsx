import React, { useState } from 'react';
import Icon from './Icon';

export default function OnboardingQuiz({ initialProfile, onSaveProfile }) {
  const [prefs, setPrefs] = useState({
    workMode: 'remote',
    wheelchairRamp: false,
    dedicatedElevator: false,
    adaptedRestroom: false,
    dedicatedParking: false,
    directCommunication: false,
    quietSpace1on1: false,
    writtenChatEmail: false,
    processingTime: false,
    adjustableDesk: false,
    ergonomicChair: false,
    largeMonitors: false,
    visualAssistant: false,
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
        prefs.directCommunication && "Instrucțiuni scrise și directe: nevoie de sarcini scrise în detaliu și comunicare 100% directă",
        prefs.quietSpace1on1 && "Spațiu liniștit / Discuții 1-la-1: nevoie de spații fără zgomot de fundal și comunicare individuală",
        prefs.writtenChatEmail && "Comunicare în scris (Chat/E-mail): prefer comunicarea pe chat/e-mail în locul apelurilor neanunțate",
        prefs.processingTime && "Timp de procesare & Înțelegere ritm: nevoie de scurt timp de gândire înainte de a răspunde",
        prefs.adjustableDesk && "birou reglabil",
        prefs.ergonomicChair && "scaun ergonomic",
        prefs.largeMonitors && "monitoare mari",
        prefs.visualAssistant && "asistent vizual"
      ].filter(Boolean).join(" | ") || "Fără cerințe specifice.",
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
          needs: ["Exclusive remote work", "Visual assistant support"],
          preferences: ["Direct communication", "Quiet environment"],
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
          <Icon name="triangle-alert" /> Eroare la salvarea profilului: {error}
        </div>
      )}

      {/* 1. Regim de lucru */}
      <div className="section-card">
        <h3><Icon name="briefcase" /> Regim de lucru</h3>
        <div className="radio-tile-group">
          <button
            type="button"
            className={`radio-tile ${prefs.workMode === 'remote' ? 'active' : ''}`}
            onClick={() => handleRadioChange('remote')}
          >
            <span className="tile-icon"><Icon name="house" size={28} /></span>
            <span className="tile-label">Exclusive Remote</span>
          </button>

          <button
            type="button"
            className={`radio-tile ${prefs.workMode === 'hybrid' ? 'active' : ''}`}
            onClick={() => handleRadioChange('hybrid')}
          >
            <span className="tile-icon"><Icon name="building" size={28} /></span>
            <span className="tile-label">Hybrid</span>
          </button>

          <button
            type="button"
            className={`radio-tile ${prefs.workMode === 'nu_conteaza' ? 'active' : ''}`}
            onClick={() => handleRadioChange('nu_conteaza')}
          >
            <span className="tile-icon"><Icon name="globe" size={28} /></span>
            <span className="tile-label">Nu contează</span>
          </button>
        </div>
      </div>

      {/* 2. Accesibilitate la sediu */}
      <div className="section-card">
        <h3><Icon name="accessibility" /> Accesibilitate la sediu fizic</h3>
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
        <h3><Icon name="message-circle" /> Comunicare</h3>
        <p className="section-subtitle">Canale de comunicare și interacțiune preferate:</p>
        <div className="checkbox-grid">
          <label className={`custom-checkbox ${prefs.directCommunication ? 'checked' : ''}`}>
            <input type="checkbox" name="directCommunication" checked={prefs.directCommunication} onChange={handleCheckboxChange} />
            <span className="checkbox-indicator"></span>
            <span className="checkbox-text"><strong>Instrucțiuni scrise și directe:</strong> Am nevoie de sarcini scrise în detaliu și comunicare 100% directă.</span>
          </label>

          <label className={`custom-checkbox ${prefs.quietSpace1on1 ? 'checked' : ''}`}>
            <input type="checkbox" name="quietSpace1on1" checked={prefs.quietSpace1on1} onChange={handleCheckboxChange} />
            <span className="checkbox-indicator"></span>
            <span className="checkbox-text"><strong>Spațiu liniștit / Discuții 1-la-1:</strong> Am nevoie de spații fără zgomot de fundal și prefer comunicarea individuală.</span>
          </label>

          <label className={`custom-checkbox ${prefs.writtenChatEmail ? 'checked' : ''}`}>
            <input type="checkbox" name="writtenChatEmail" checked={prefs.writtenChatEmail} onChange={handleCheckboxChange} />
            <span className="checkbox-indicator"></span>
            <span className="checkbox-text"><strong>Comunicare în scris (Chat/E-mail):</strong> Prefer comunicarea pe chat sau e-mail în locul apelurilor telefonice/video neanunțate.</span>
          </label>

          <label className={`custom-checkbox ${prefs.processingTime ? 'checked' : ''}`}>
            <input type="checkbox" name="processingTime" checked={prefs.processingTime} onChange={handleCheckboxChange} />
            <span className="checkbox-indicator"></span>
            <span className="checkbox-text"><strong>Timp de procesare & Înțelegere ritm:</strong> Am nevoie de scurt timp de gândire înainte de a răspunde și de înțelegere dacă îmi pierd firul ideilor sau am o vorbire mai impulsivă.</span>
          </label>
        </div>
      </div>

      {/* 4. Ajustări specifice */}
      <div className="section-card">
        <h3><Icon name="wrench" /> Ajustări specifice la locul de muncă</h3>
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

          <label className={`custom-checkbox ${prefs.visualAssistant ? 'checked' : ''}`}>
            <input type="checkbox" name="visualAssistant" checked={prefs.visualAssistant} onChange={handleCheckboxChange} />
            <span className="checkbox-indicator"></span>
            <span className="checkbox-text">Asistent vizual</span>
          </label>
        </div>
      </div>

      {/* 5. Alte nevoi */}
      <div className="section-card">
        <h3><Icon name="pencil" /> Alte cerințe</h3>
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
        {loading
          ? <><Icon name="loader" className="spin" /> Se generează profilul AI (20-40s)...</>
          : <><Icon name="save" /> Salvează Profilul</>}
      </button>
    </form>
  );
}
