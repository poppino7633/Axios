import React, { useState, useEffect } from 'react';

export default function OnboardingQuiz({ onSave }) {
  const [prefs, setPrefs] = useState({
    // Regim de lucru (Opțiune unică - Single choice)
    workMode: 'nu_conteaza', // 'remote', 'hybrid', 'nu_conteaza'

    // Accesibilitate la sediu fizic (Multiple choice)
    wheelchairRamp: false,
    dedicatedElevator: false,
    adaptedRestroom: false,
    dedicatedParking: false,

    // Comunicare (Multiple choice)
    writtenCommunication: false,
    noUnannouncedCalls: false,
    lowSensoryEnvironment: false,
    screenReader: false,

    // Ajustări specifice la locul de muncă (Multiple choice)
    adjustableDesk: false,
    ergonomicChair: false,
    largeMonitors: false,

    // Alte nevoi (Text Box)
    otherNeeds: ''
  });

  useEffect(() => {
    // Încărcare preferințe salvate anterior
    if (typeof chrome !== 'undefined' && chrome.storage) {
      chrome.storage.local.get(['userPreferences'], (result) => {
        if (result.userPreferences) setPrefs(result.userPreferences);
      });
    } else {
      const saved = localStorage.getItem('userPreferences');
      if (saved) setPrefs(JSON.parse(saved));
    }
  }, []);

  const handleCheckboxChange = (e) => {
    const { name, checked } = e.target;
    setPrefs(prev => ({ ...prev, [name]: checked }));
  };

  const handleRadioChange = (e) => {
    setPrefs(prev => ({ ...prev, workMode: e.target.value }));
  };

  const handleTextChange = (e) => {
    setPrefs(prev => ({ ...prev, otherNeeds: e.target.value }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (typeof chrome !== 'undefined' && chrome.storage) {
      chrome.storage.local.set({ userPreferences: prefs }, () => {
        chrome.runtime?.sendMessage({ action: "PREFERENCES_UPDATED", data: prefs });
        alert("Profilul a fost salvat!");
        if (onSave) onSave(prefs);
      });
    } else {
      localStorage.setItem('userPreferences', JSON.stringify(prefs));
      alert("Profilul a fost salvat în LocalStorage!");
      if (onSave) onSave(prefs);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="quiz-form">
      <h2>Profil Accesibilitate</h2>

      {/* 1. Regim de lucru (Radio button - Opțiune unică) */}
      <fieldset>
        <legend>Regim de lucru</legend>
        <label>
          <input 
            type="radio" 
            name="workMode" 
            value="remote" 
            checked={prefs.workMode === 'remote'} 
            onChange={handleRadioChange} 
          />
          <span>Exclusive remote</span>
        </label>
        <label>
          <input 
            type="radio" 
            name="workMode" 
            value="hybrid" 
            checked={prefs.workMode === 'hybrid'} 
            onChange={handleRadioChange} 
          />
          <span>Hybrid</span>
        </label>
        <label>
          <input 
            type="radio" 
            name="workMode" 
            value="nu_conteaza" 
            checked={prefs.workMode === 'nu_conteaza'} 
            onChange={handleRadioChange} 
          />
          <span>Nu contează</span>
        </label>
      </fieldset>

      {/* 2. Accesibilitate la sediu fizic (Multiple choice) */}
      <fieldset>
        <legend>Accesibilitate la sediu fizic</legend>
        <p className="subtitle">Am nevoie de:</p>
        <label>
          <input 
            type="checkbox" 
            name="wheelchairRamp" 
            checked={prefs.wheelchairRamp} 
            onChange={handleCheckboxChange} 
          />
          <span>Rampă de acces</span>
        </label>
        <label>
          <input 
            type="checkbox" 
            name="dedicatedElevator" 
            checked={prefs.dedicatedElevator} 
            onChange={handleCheckboxChange} 
          />
          <span>Lift dedicat</span>
        </label>
        <label>
          <input 
            type="checkbox" 
            name="adaptedRestroom" 
            checked={prefs.adaptedRestroom} 
            onChange={handleCheckboxChange} 
          />
          <span>Toaletă adaptată</span>
        </label>
        <label>
          <input 
            type="checkbox" 
            name="dedicatedParking" 
            checked={prefs.dedicatedParking} 
            onChange={handleCheckboxChange} 
          />
          <span>Parcare dedicată</span>
        </label>
      </fieldset>

      {/* 3. Comunicare (Multiple choice) */}
      <fieldset>
        <legend>Comunicare</legend>
        <p className="subtitle">Canale de comunicare preferate:</p>
        <label>
          <input 
            type="checkbox" 
            name="writtenCommunication" 
            checked={prefs.writtenCommunication} 
            onChange={handleCheckboxChange} 
          />
          <span>Comunicare predominant în scris</span>
        </label>
        <label>
          <input 
            type="checkbox" 
            name="noUnannouncedCalls" 
            checked={prefs.noUnannouncedCalls} 
            onChange={handleCheckboxChange} 
          />
          <span>Fără apeluri telefonice / audio neanunțate</span>
        </label>
        <label>
          <input 
            type="checkbox" 
            name="lowSensoryEnvironment" 
            checked={prefs.lowSensoryEnvironment} 
            onChange={handleCheckboxChange} 
          />
          <span>Mediu de lucru liniștit / low-sensory</span>
        </label>
        <label>
          <input 
            type="checkbox" 
            name="screenReader" 
            checked={prefs.screenReader} 
            onChange={handleCheckboxChange} 
          />
          <span>Screen reader</span>
        </label>
      </fieldset>

      {/* 4. Ajustări specifice la locul de muncă (Multiple choice) */}
      <fieldset>
        <legend>Ajustări specifice la locul de muncă</legend>
        <p className="subtitle">Am nevoie de:</p>
        <label>
          <input 
            type="checkbox" 
            name="adjustableDesk" 
            checked={prefs.adjustableDesk} 
            onChange={handleCheckboxChange} 
          />
          <span>Birou reglabil</span>
        </label>
        <label>
          <input 
            type="checkbox" 
            name="ergonomicChair" 
            checked={prefs.ergonomicChair} 
            onChange={handleCheckboxChange} 
          />
          <span>Scaun special</span>
        </label>
        <label>
          <input 
            type="checkbox" 
            name="largeMonitors" 
            checked={prefs.largeMonitors} 
            onChange={handleCheckboxChange} 
          />
          <span>Monitoare mari</span>
        </label>
      </fieldset>

      {/* 5. Others (Text Box) */}
      <fieldset>
        <legend>Others</legend>
        <label htmlFor="otherNeeds">Alte nevoi:</label>
        <textarea
          id="otherNeeds"
          name="otherNeeds"
          rows="3"
          placeholder="Scrie aici alte cerințe specifice..."
          value={prefs.otherNeeds}
          onChange={handleTextChange}
          className="text-input"
        />
      </fieldset>

      <button type="submit" className="primary-btn">Salvează Profilul</button>
    </form>
  );
}