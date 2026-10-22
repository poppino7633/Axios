export const MOCK_ANALYSIS_RESULT = {
  overallMatch: "PARTIAL_MATCH",
  scorePercentage: 85,
  findings: [
    {
      criterion: "workMode",
      status: "confirmed",
      explanation: "Jobul este 100% Remote, ideal pentru mobilitate redusă.",
      evidence: "Regim de lucru: Full Remote din orice oraș al României."
    },
    {
      criterion: "writtenCommunication",
      status: "confirmed",
      explanation: "Comunicarea internă se face prin Slack și Asana.",
      evidence: "Echipa colaborează asincron prin mesagerie scrisă."
    },
    {
      criterion: "wheelchairRamp",
      status: "unknown",
      explanation: "Nu se menționează detalii despre accesibilitatea fizică la sediu.",
      evidence: null
    }
  ],
  employerQuestions: [
    "Dacă este nevoie de prezență la sediu, clădirea dispune de rampă de acces și lift dedicat?",
    "Pachetul de beneficii include decontare pentru scaun ergonomic / birou reglabil?"
  ]
};