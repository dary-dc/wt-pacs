-- The study index on SQLite, README §Engines: schema.sql's columns, dates and times stored as DICOM writes them, and
-- `name_key`, the patient name folded by `lite::pn_key`. `WITHOUT ROWID` clusters the study rows on their UID.
CREATE TABLE study (
  study_uid                TEXT NOT NULL PRIMARY KEY,
  host                     TEXT NOT NULL,
  revision                 INTEGER NOT NULL,
  access_key               TEXT NOT NULL,
  patient_name             TEXT NOT NULL,
  patient_id               TEXT NOT NULL,
  issuer_of_patient_id     TEXT NOT NULL,
  patient_birth_date       TEXT,
  patient_sex              TEXT,
  study_date               TEXT NOT NULL,
  study_time               TEXT NOT NULL,
  accession_number         TEXT,
  study_id                 TEXT,
  referring_physician_name TEXT,
  modalities_in_study      TEXT,
  study_description        TEXT,
  number_of_series         INTEGER NOT NULL,
  number_of_instances      INTEGER NOT NULL,
  name_key                 TEXT NOT NULL,
  updated_at               TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now'))
) WITHOUT ROWID;

CREATE TABLE series (
  series_uid          TEXT NOT NULL PRIMARY KEY,
  study_uid           TEXT NOT NULL,
  modality            TEXT NOT NULL,
  series_number       INTEGER,
  series_description  TEXT,
  number_of_instances INTEGER NOT NULL,
  number_of_frames    INTEGER NOT NULL,
  codec               TEXT NOT NULL
);
