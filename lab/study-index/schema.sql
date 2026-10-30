-- The study index, docs/adr/study-index.md §4: list-time fields only. Text columns take the server default,
-- utf8mb4_0900_ai_ci, which is the PN matching of §4; UIDs, keys and codes are ASCII and binary.
CREATE TABLE study (
  study_uid                VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  host                     VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  revision                 BIGINT UNSIGNED NOT NULL,
  access_key               VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  patient_name             VARCHAR(324) NOT NULL,
  patient_id               VARCHAR(64) NOT NULL,
  issuer_of_patient_id     VARCHAR(64) NOT NULL,
  patient_birth_date       DATE NULL,
  patient_sex              VARCHAR(16) NULL,
  study_date               DATE NOT NULL,
  study_time               TIME NOT NULL,
  accession_number         VARCHAR(16) NULL,
  study_id                 VARCHAR(16) NULL,
  referring_physician_name VARCHAR(324) NULL,
  modalities_in_study      VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  study_description        VARCHAR(64) NULL,
  number_of_series         INT UNSIGNED NOT NULL,
  number_of_instances      INT UNSIGNED NOT NULL,
  updated_at               TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  KEY newest (access_key, study_date, study_time, study_uid),
  KEY by_name (access_key, patient_name),
  KEY by_patient_id (access_key, patient_id, issuer_of_patient_id),
  KEY by_accession (access_key, accession_number),
  KEY by_host (host)
);

CREATE TABLE series (
  series_uid          VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  study_uid           VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  modality            VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  series_number       INT NULL,
  series_description  VARCHAR(64) NULL,
  number_of_instances INT UNSIGNED NOT NULL,
  number_of_frames    INT UNSIGNED NOT NULL,
  codec               CHAR(4) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  KEY of_study (study_uid, series_number),
  KEY study_modality (study_uid, modality)
);
