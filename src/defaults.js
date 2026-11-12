export const STUDIO_DEFAULTS = {
  name: "%%studioName%%",
  address: "%%studioAddress%%",
  contact: "%%studioContact%%",
  location: "%%studioLocation%%",
  retention:
    "%%retentionText%%",
  recipients:
    "%%accessText%%",
};

const DEFAULT_PHOTO_TEXT =
  "Ich erlaube %%photoStudio%% freiwillig, Fotos meines fertigen Tattoos anzufertigen und zur Darstellung eigener Tattoo-Arbeiten im Studio-Portfolio, %%photoChannels%% zu veröffentlichen. Veröffentlicht werden keine Namen, Gesichter, Gesundheitsangaben, Einwilligungsformulare oder Unterschriften. Das Tattoo selbst kann mich dennoch erkennbar machen. Ein Nein hat keine Auswirkungen auf die Tätowierung. Ich kann diese Einwilligung jederzeit für die Zukunft mündlich beim Inhaber oder %%revocationContact%% widerrufen, auch für einzelne der genannten Veröffentlichungswege. Bis zum Widerruf erfolgte Verarbeitungen bleiben rechtmäßig. Das Studio beendet die betroffene Nutzung und entfernt die Fotos aus seinen beeinflussbaren Veröffentlichungen, soweit keine andere Rechtsgrundlage besteht. Bei Internet- und Social-Media-Veröffentlichungen können die Plattformbetreiber und Dritte die Bilder speichern, weiterverbreiten oder außerhalb der EU verarbeiten; eine vollständige Rückholung fremder Kopien ist nicht gewährleistet. Für andere Nutzungszwecke oder weitere Plattformen ist eine neue Vereinbarung erforderlich. Rechte am Tattoo-Motiv werden durch diese Erklärung nicht übertragen.";

const DEFAULT_MEDICAL = [
  {
    id: "bloodMeds",
    title: "Blutverdünnende Medikamente",
    hint: "Nimmst du z. B. Aspirin, ASS oder Marcumar ein?",
  },
  {
    id: "allergies",
    title: "Allergien oder Unverträglichkeiten",
    hint: "z. B. gegen Pflaster, Latex, Nickel, Desinfektionsmittel oder Farbstoffe",
  },
  {
    id: "infections",
    title: "Bekannte Infektionskrankheiten",
    hint: "z. B. Hepatitis oder HIV; bitte nur relevante Angaben machen",
  },
  {
    id: "skin",
    title: "Hauterkrankungen an der Tattoo-Stelle",
    hint: "z. B. Neurodermitis, Schuppenflechte, Ekzeme oder offene Hautstellen",
  },
  {
    id: "chronic",
    title: "Herz, Diabetes, Epilepsie oder Kreislauf",
    hint: "Bestehen Herzerkrankungen, Diabetes, Epilepsie oder eine Neigung zu Kreislaufproblemen?",
  },
  {
    id: "pregnancy",
    title: "Schwangerschaft oder Stillzeit",
    hint: "Bist du schwanger oder stillst du aktuell?",
  },
  {
    id: "painkillers",
    title: "Schmerzmittel vor dem Termin",
    hint: "Hast du vor dem Termin Schmerzmittel eingenommen?",
  },
  {
    id: "clotting",
    title: "Blutgerinnung oder Wundheilung",
    hint: "Bestehen Gerinnungsstörungen, schlechte Wundheilung oder eine Neigung zu überschießenden Narben?",
  },
  {
    id: "immune",
    title: "Immunsystem, Antibiotika oder weitere Therapie",
    hint: "Besteht eine Immunschwäche oder nimmst du Antibiotika, Immunsuppressiva oder andere relevante Medikamente?",
  },
  {
    id: "acute",
    title: "Akute Erkrankung oder Fieber",
    hint: "Bist du aktuell krank, fiebrig oder besteht ein akuter Infekt?",
  },
  {
    id: "alcohol24",
    title: "Alkohol in den letzten 24 Stunden",
    hint: "Hast du in den vergangenen 24 Stunden Alkohol konsumiert?",
  },
];

const DEFAULT_LEGAL = [
  {
    id: "adult",
    title: "Ich bin mindestens 18 Jahre alt.",
    text: "Das gilt heute und zum angegebenen Tattoo-Termin.",
  },
  {
    id: "voluntary",
    title: "Ich entscheide mich freiwillig für dieses Tattoo.",
    text: "Ich willige in das Einbringen von Farbpigmenten mittels Nadeln und die damit verbundene Verletzung meiner Haut an der beschriebenen Körperstelle ein.",
  },
  {
    id: "consultation",
    title: "Meine Fragen wurden im persönlichen Gespräch beantwortet.",
    text: "Ich wurde verständlich aufgeklärt, hatte ausreichend Zeit für Fragen und habe relevante gesundheitliche Angaben wahrheitsgemäß gemacht. Änderungen teile ich vor Beginn mit.",
  },
  {
    id: "risks",
    title: "Ich wurde über die Risiken aufgeklärt.",
    text: "Dazu zählen Schmerzen, Blutungen, Schwellungen, Rötungen, Entzündungen, Infektionen, allergische Reaktionen und Vernarbungen. Reaktionen können auch verzögert auftreten; gesundheitliche Langzeitfolgen sind nicht abschließend geklärt.",
  },
  {
    id: "permanent",
    title: "Ich verstehe, dass mein Tattoo dauerhaft ist.",
    text: "Eine vollständige und narbenfreie Entfernung kann nicht garantiert werden. Farben und Konturen können sich durch Haut, Heilung, Alterung und Sonne verändern.",
  },
  {
    id: "design",
    title: "Motiv, Größe und Platzierung sind mit mir abgestimmt.",
    text: "Ich habe die besprochene Vorlage bzw. Schablone geprüft und stimme der Ausführung zu. Weitere Änderungen werden vor Beginn mit mir besprochen.",
  },
  {
    id: "aftercare",
    title: "Ich habe die schriftlichen Pflegehinweise erhalten und verstanden.",
    text: "Ich werde die individuelle Nachsorge befolgen und bei Anzeichen einer Infektion, Allergie oder anderen Komplikationen ärztlichen Rat suchen sowie das Studio informieren.",
  },
  {
    id: "liability",
    title: "Nachsorge und gesetzliche Ansprüche",
    review: false,
    text: "Ich werde die erhaltenen Pflegehinweise beachten und bei Problemen ärztlichen Rat suchen sowie das Studio informieren. Meine gesetzlichen Ansprüche wegen einer fehlerhaften Leistung oder Pflichtverletzung des Studios bleiben unberührt. Diese Erklärung enthält keinen Haftungsverzicht.",
  },
  {
    id: "privacy",
    title: "Ich willige ausdrücklich in die Verarbeitung meiner Gesundheitsangaben ein.",
    review: true,
    text: "Ich willige ausdrücklich ein, dass %%healthStudio%% die von mir in diesem Formular gemachten Gesundheitsangaben für das persönliche Vorgespräch, die Vorbereitung der vereinbarten Tätowierung und die Dokumentation meiner Aufklärung und Einwilligung verarbeitet und im lokalen Einwilligungs-PDF speichert. Die Datenschutzhinweise zu Zugriff, Aufbewahrung und meinen Rechten habe ich vor der Entscheidung erhalten. Ich kann diese Einwilligung jederzeit mündlich beim Inhaber oder %%revocationContact%% für die Zukunft widerrufen. Die Verarbeitung bis zum Widerruf bleibt rechtmäßig. Eine weitere Aufbewahrung zur Rechtsverteidigung ist nur unter den in den Datenschutzhinweisen genannten Voraussetzungen möglich. Die Fotoverwendung entscheide ich davon unabhängig.",
  },
];

export const DEFAULT_SETTINGS = {
  schemaVersion: 1,
  savedAt: null,
  studio: { ...STUDIO_DEFAULTS },
  app: {
    brand: "INKFORM",
    formVersion: "1.2 / 2026-11-06",
    documentTitle: "Einwilligung zur Tätowierung",
    eyebrow: "%%eyebrowPrefix%%KUNDENFORMULAR",
    headline: "Einwilligung zur Tätowierung",
    description:
      "Willkommen %%welcomeStudio%%. Bitte ergänze deine Angaben und besprich offene Fragen vor deinem Tattoo mit deinem Tätowierer.",
    defaultArtist: "",
    photoText: DEFAULT_PHOTO_TEXT,
    photoDeniedText:
      "Die angebotene Fotoeinwilligung wurde abgelehnt. Es besteht keine Einwilligung zur Veröffentlichung meiner Tattoo-Fotos für Portfolio, Website oder Social Media. Ein Nein hat keine Auswirkungen auf die Behandlung.",
    signatureText:
      "Mit meiner Unterschrift bestätige ich meine Angaben und die von mir ausgewählten Erklärungen. Ich willige freiwillig in die beschriebene Tätowierung ein. Die Fotoentscheidung bleibt davon unabhängig.",
    privacyTemplate: `Verantwortlich: {{studio.name}}
Anschrift: {{studio.address}}
Kontakt und Widerruf: {{studio.contact}}

Zwecke und Rechtsgrundlagen: Die für die Vorbereitung und Durchführung des Tattoo-Termins erforderlichen Stamm-, Kontakt- und Termindaten werden auf Grundlage von Art. 6 Abs. 1 lit. b DSGVO verarbeitet. Für die Gesundheitsangaben zur Vorbereitung, zum persönlichen Vorgespräch und zur Dokumentation holen wir eine ausdrückliche Einwilligung nach Art. 6 Abs. 1 lit. a und Art. 9 Abs. 2 lit. a DSGVO ein. Tattoo-Fotos für das Portfolio und die genannten Internetauftritte werden nur nach gesonderter freiwilliger Einwilligung verwendet (Art. 6 Abs. 1 lit. a DSGVO).

Soweit eine weitere Aufbewahrung zur Geltendmachung, Ausübung oder Verteidigung von Rechtsansprüchen erforderlich ist, kommt Art. 6 Abs. 1 lit. f DSGVO und bei Gesundheitsdaten zusätzlich Art. 9 Abs. 2 lit. f DSGVO zur Anwendung. Das berechtigte Interesse ist der erforderliche Nachweis der Aufklärung und Einwilligung bzw. die Rechtsverfolgung oder Rechtsverteidigung. Daraus folgt keine unbeschränkte Vorratsspeicherung.

Aufbewahrung und Löschung: {{studio.retention}}

Zugriff, Empfänger und Ablage: {{studio.recipients}}

Widerruf: Eine erteilte Einwilligung kann jederzeit mündlich beim Inhaber oder über die oben genannte E-Mail-Adresse für die Zukunft widerrufen werden. Die Verarbeitung bis zum Widerruf bleibt rechtmäßig. Ab dem Widerruf entfällt die Verarbeitung auf Grundlage dieser Einwilligung. Eine davon unabhängige weitere Aufbewahrung erfolgt nur bei bestehender anderer Rechtsgrundlage und nur im erforderlichen Umfang.

Deine Rechte: Unter den gesetzlichen Voraussetzungen bestehen Rechte auf Auskunft, Berichtigung, Löschung, Einschränkung der Verarbeitung und Datenübertragbarkeit. Gegen eine Verarbeitung auf Grundlage berechtigter Interessen kannst du aus Gründen deiner besonderen Situation Widerspruch einlegen. Du kannst dich bei %%complaintAuthority%%.

Erforderliche und freiwillige Angaben: Die Bereitstellung der Gesundheitsangaben ist nicht gesetzlich vorgeschrieben. Bitte teile nur für die vereinbarte Tätowierung relevante Angaben mit. Fehlen für eine sichere Durchführung erforderliche Informationen, muss dies im persönlichen Vorgespräch geklärt werden; gegebenenfalls kann die Tätowierung nicht durchgeführt werden. Die Fotoeinwilligung ist freiwillig; eine Ablehnung hat keine Nachteile für die Tätowierung. Es gibt keine automatisierte Entscheidung oder Profilbildung.

Die App verarbeitet deine Angaben und deine Unterschrift auf diesem Gerät und erstellt das PDF lokal. Sie übermittelt diese Kundendaten nicht ins Internet. Noch nicht abgeschlossene Formulareingaben gehen beim Schließen oder Neuladen verloren. Beim Erstellen des unterschriebenen PDFs werden Name, Tattoo-Termin, Artist, Gesamtpreis und gegebenenfalls Anzahlung zusätzlich in einer lokalen Umsatzübersicht gespeichert. Diese dient der Zuordnung und Auswertung der vereinbarten Leistungen; Gesundheitsangaben und Unterschriften werden darin nicht gespeichert. Die Verarbeitung dieser Vertrags- und Abrechnungsangaben erfolgt zur Vertragsabwicklung nach Art. 6 Abs. 1 lit. b DSGVO. Zugriff, Sicherung und erforderliche Löschung dieser Übersicht liegen beim Inhaber. Das unterschriebene PDF wird zusätzlich als Kopie im Speicher der App auf diesem Gerät abgelegt, bis das Studio diese Kopie löscht; sie wird nicht übermittelt. Für die Ablage, den Zugriff und die Aufbewahrung der gespeicherten PDF-Dateien ist das Studio verantwortlich.`,
  },
  medical: DEFAULT_MEDICAL,
  legal: DEFAULT_LEGAL,
};
