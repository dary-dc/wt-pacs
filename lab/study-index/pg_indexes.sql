-- tuned.sql's shape: `newest` covers the modalities and the name, `by_name` the date, both the UID, so a page's UIDs come from an
-- index-only scan.
CREATE INDEX newest ON study (access_key, study_date, study_time, study_uid) INCLUDE (modalities_in_study, name_key);
CREATE INDEX by_name ON study (access_key, name_key, study_date, study_time) INCLUDE (study_uid);
CREATE INDEX by_patient_id ON study (access_key, patient_id, issuer_of_patient_id);
CREATE INDEX by_accession ON study (access_key, accession_number);
CREATE INDEX by_host ON study (host);
CREATE INDEX of_study ON series (study_uid, series_number);
CREATE INDEX study_modality ON series (study_uid, modality);
