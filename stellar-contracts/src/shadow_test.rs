#![cfg(test)]

extern crate std;

use super::shadow::*;
use soroban_sdk::{contract, contractimpl, testutils::Address as _, Address, Env, String, Vec};

/// Test-only contract. `shadow` is a module of plain functions with no entry
/// point of its own, so a test needs a contract frame to reach `env.storage()`.
/// This empty contract supplies one and adds nothing to the production ABI.
#[contract]
pub struct ShadowStorageFrame;

#[contractimpl]
impl ShadowStorageFrame {}

/// `shadow` is a module of plain functions, not a `#[contractimpl]`, so there is
/// no generated client and no implicit contract frame in a test. The SDK asserts
/// that `env.storage()` is only reached from inside a contract, and storage is
/// namespaced by the *current* contract id — so a test that wants storage to
/// persist across calls has to enter one stable frame and stay in it.
struct Harness {
    env: Env,
    contract_id: Address,
}

impl Harness {
    fn new() -> Self {
        let env = Env::default();
        let contract_id = env.register(ShadowStorageFrame, ());
        Self { env, contract_id }
    }

    /// Run `f` inside the harness' single contract frame.
    fn run<R>(&self, f: impl FnOnce() -> R) -> R {
        self.env.as_contract(&self.contract_id, f)
    }

    fn actor(&self) -> Address {
        Address::generate(&self.env)
    }
}

fn create_test_schema(env: &Env, creator: &Address) -> MetadataSchemaRecord {
    let mut fields = Vec::new(env);
    fields.push_back(MetadataFieldRule {
        name: String::from_str(env, "title"),
        field_type: MetadataFieldType::String,
        required: true,
        min_length: 1,
        max_length: 200,
    });
    fields.push_back(MetadataFieldRule {
        name: String::from_str(env, "courseName"),
        field_type: MetadataFieldType::String,
        required: true,
        min_length: 1,
        max_length: 500,
    });
    fields.push_back(MetadataFieldRule {
        name: String::from_str(env, "grade"),
        field_type: MetadataFieldType::String,
        required: false,
        min_length: 0,
        max_length: 10,
    });
    fields.push_back(MetadataFieldRule {
        name: String::from_str(env, "hours"),
        field_type: MetadataFieldType::Number,
        required: false,
        min_length: 0,
        max_length: 0,
    });

    let mut required_fields = Vec::new(env);
    required_fields.push_back(String::from_str(env, "title"));
    required_fields.push_back(String::from_str(env, "courseName"));

    MetadataSchemaRecord {
        id: String::from_str(env, "schema-001"),
        name: String::from_str(env, "course-certificate"),
        version: MetadataSchemaVersion {
            major: 1,
            minor: 0,
            patch: 0,
        },
        fields,
        required_fields,
        allow_custom_fields: true,
        created_by: creator.clone(),
        created_at: 1000,
        is_active: true,
        previous_version_id: None,
    }
}

/// Deterministic 24-char schema id for index `idx`.
fn id_for(env: &Env, idx: u32) -> String {
    let mut s = std::format!("schema-{:0>17}", idx);
    s.truncate(24);
    String::from_str(env, s.as_str())
}

/// A schema with `idx`-specific identity and six string fields, so each record
/// has real bulk. All share one name on purpose: that is what grows the history
/// list, one of the collections that used to live in the single `instance()` entry.
fn bulk_schema(env: &Env, creator: &Address, idx: u32) -> MetadataSchemaRecord {
    let mut fields = Vec::new(env);
    for f in 0..6u32 {
        let field_name = std::format!("field-{}", f);
        fields.push_back(MetadataFieldRule {
            name: String::from_str(env, field_name.as_str()),
            field_type: MetadataFieldType::String,
            required: f == 0,
            min_length: 1,
            max_length: 256,
        });
    }

    let mut required_fields = Vec::new(env);
    required_fields.push_back(String::from_str(env, "field-0"));

    MetadataSchemaRecord {
        id: id_for(env, idx),
        name: String::from_str(env, "course-certificate"),
        version: MetadataSchemaVersion {
            major: idx + 1,
            minor: 0,
            patch: 0,
        },
        fields,
        required_fields,
        allow_custom_fields: true,
        created_by: creator.clone(),
        created_at: 1000 + idx as u64,
        is_active: true,
        previous_version_id: None,
    }
}

fn entry(env: &Env, key: &str, value: &str, value_type: MetadataFieldType) -> MetadataEntry {
    MetadataEntry {
        key: String::from_str(env, key),
        value: String::from_str(env, value),
        value_type,
    }
}

// ─── Registration / lookup ───────────────────────────────────────────────────

#[test]
fn test_register_schema() {
    let h = Harness::new();
    let creator = h.actor();
    h.run(|| {
        let env = &h.env;
        let schema = create_test_schema(env, &creator);

        assert!(register_schema(env, schema.clone()).is_ok());

        let fetched = get_schema(env, &schema.id).unwrap();
        assert_eq!(fetched.name, schema.name);
        assert_eq!(fetched.version.major, 1);
        assert_eq!(fetched.fields.len(), 4);
    });
}

#[test]
fn test_register_duplicate_schema_fails() {
    let h = Harness::new();
    let creator = h.actor();
    h.run(|| {
        let env = &h.env;
        let schema = create_test_schema(env, &creator);

        register_schema(env, schema.clone()).unwrap();
        let result = register_schema(env, schema);
        assert_eq!(result.err(), Some(MetadataError::SchemaAlreadyExists));
    });
}

// ─── Validation ──────────────────────────────────────────────────────────────

#[test]
fn test_validate_valid_metadata() {
    let h = Harness::new();
    let creator = h.actor();
    h.run(|| {
        let env = &h.env;
        let schema = create_test_schema(env, &creator);
        register_schema(env, schema).unwrap();

        let mut entries = Vec::new(env);
        entries.push_back(entry(
            env,
            "title",
            "Web Development Certificate",
            MetadataFieldType::String,
        ));
        entries.push_back(entry(
            env,
            "courseName",
            "Full Stack Web Development",
            MetadataFieldType::String,
        ));
        entries.push_back(entry(env, "grade", "A+", MetadataFieldType::String));

        let schema_id = String::from_str(env, "schema-001");
        let cert_id = String::from_str(env, "cert-001");
        let result = validate_metadata(env, &schema_id, &entries, &cert_id);

        assert!(result.valid);
        assert_eq!(result.errors.len(), 0);
    });
}

#[test]
fn test_validate_missing_required_fields() {
    let h = Harness::new();
    let creator = h.actor();
    h.run(|| {
        let env = &h.env;
        let schema = create_test_schema(env, &creator);
        register_schema(env, schema).unwrap();

        let mut entries = Vec::new(env);
        entries.push_back(entry(env, "grade", "B+", MetadataFieldType::String));

        let schema_id = String::from_str(env, "schema-001");
        let cert_id = String::from_str(env, "cert-002");
        let result = validate_metadata(env, &schema_id, &entries, &cert_id);

        assert!(!result.valid);
        assert_eq!(result.errors.len(), 2);
    });
}

#[test]
fn test_validate_type_mismatch() {
    let h = Harness::new();
    let creator = h.actor();
    h.run(|| {
        let env = &h.env;
        let schema = create_test_schema(env, &creator);
        register_schema(env, schema).unwrap();

        let mut entries = Vec::new(env);
        entries.push_back(entry(env, "title", "Test Cert", MetadataFieldType::String));
        entries.push_back(entry(
            env,
            "courseName",
            "Course",
            MetadataFieldType::String,
        ));
        // `hours` is declared as Number, supplied as String.
        entries.push_back(entry(env, "hours", "forty", MetadataFieldType::String));

        let schema_id = String::from_str(env, "schema-001");
        let cert_id = String::from_str(env, "cert-003");
        let result = validate_metadata(env, &schema_id, &entries, &cert_id);

        assert!(!result.valid);
        let type_error = result
            .errors
            .iter()
            .find(|e| e.constraint == String::from_str(env, "type"));
        assert!(type_error.is_some());
    });
}

#[test]
fn test_validate_string_length_constraints() {
    let h = Harness::new();
    let creator = h.actor();
    h.run(|| {
        let env = &h.env;
        let schema = create_test_schema(env, &creator);
        register_schema(env, schema).unwrap();

        let mut entries = Vec::new(env);
        entries.push_back(entry(env, "title", "OK Title", MetadataFieldType::String));
        entries.push_back(entry(
            env,
            "courseName",
            "Course",
            MetadataFieldType::String,
        ));
        // `grade` has max_length 10; 11 chars is too long.
        entries.push_back(entry(
            env,
            "grade",
            "ABCDEFGHIJK",
            MetadataFieldType::String,
        ));

        let schema_id = String::from_str(env, "schema-001");
        let cert_id = String::from_str(env, "cert-004");
        let result = validate_metadata(env, &schema_id, &entries, &cert_id);

        assert!(!result.valid);
        let length_error = result
            .errors
            .iter()
            .find(|e| e.constraint == String::from_str(env, "maxLength"));
        assert!(length_error.is_some());
    });
}

#[test]
fn test_validate_custom_fields_allowed() {
    let h = Harness::new();
    let creator = h.actor();
    h.run(|| {
        let env = &h.env;
        let schema = create_test_schema(env, &creator);
        register_schema(env, schema).unwrap();

        let mut entries = Vec::new(env);
        entries.push_back(entry(env, "title", "Title", MetadataFieldType::String));
        entries.push_back(entry(
            env,
            "courseName",
            "Course",
            MetadataFieldType::String,
        ));
        entries.push_back(entry(
            env,
            "customField",
            "custom value",
            MetadataFieldType::String,
        ));

        let schema_id = String::from_str(env, "schema-001");
        let cert_id = String::from_str(env, "cert-005");
        let result = validate_metadata(env, &schema_id, &entries, &cert_id);

        assert!(result.valid);
    });
}

#[test]
fn test_validate_custom_fields_disallowed() {
    let h = Harness::new();
    let creator = h.actor();
    h.run(|| {
        let env = &h.env;
        let mut schema = create_test_schema(env, &creator);
        schema.id = String::from_str(env, "schema-strict");
        schema.allow_custom_fields = false;
        register_schema(env, schema).unwrap();

        let mut entries = Vec::new(env);
        entries.push_back(entry(env, "title", "Title", MetadataFieldType::String));
        entries.push_back(entry(
            env,
            "courseName",
            "Course",
            MetadataFieldType::String,
        ));
        entries.push_back(entry(
            env,
            "unauthorized",
            "nope",
            MetadataFieldType::String,
        ));

        let schema_id = String::from_str(env, "schema-strict");
        let cert_id = String::from_str(env, "cert-006");
        let result = validate_metadata(env, &schema_id, &entries, &cert_id);

        assert!(!result.valid);
        let custom_error = result
            .errors
            .iter()
            .find(|e| e.constraint == String::from_str(env, "noCustomFields"));
        assert!(custom_error.is_some());
    });
}

#[test]
fn test_validate_nonexistent_schema() {
    let h = Harness::new();
    h.run(|| {
        let env = &h.env;
        let entries = Vec::new(env);
        let schema_id = String::from_str(env, "nonexistent");
        let cert_id = String::from_str(env, "cert-007");
        let result = validate_metadata(env, &schema_id, &entries, &cert_id);

        assert!(!result.valid);
        assert_eq!(result.errors.len(), 1);
    });
}

#[test]
fn test_validate_inactive_schema() {
    let h = Harness::new();
    let creator = h.actor();
    h.run(|| {
        let env = &h.env;
        let mut schema = create_test_schema(env, &creator);
        schema.id = String::from_str(env, "schema-inactive");
        schema.is_active = false;
        register_schema(env, schema).unwrap();

        let entries = Vec::new(env);
        let schema_id = String::from_str(env, "schema-inactive");
        let cert_id = String::from_str(env, "cert-008");
        let result = validate_metadata(env, &schema_id, &entries, &cert_id);

        assert!(!result.valid);
    });
}

// ─── Upgrade ─────────────────────────────────────────────────────────────────

#[test]
fn test_upgrade_schema() {
    let h = Harness::new();
    let creator = h.actor();
    h.run(|| {
        let env = &h.env;
        let schema = create_test_schema(env, &creator);
        register_schema(env, schema).unwrap();

        let mut new_fields = Vec::new(env);
        new_fields.push_back(MetadataFieldRule {
            name: String::from_str(env, "title"),
            field_type: MetadataFieldType::String,
            required: true,
            min_length: 1,
            max_length: 300,
        });
        new_fields.push_back(MetadataFieldRule {
            name: String::from_str(env, "courseName"),
            field_type: MetadataFieldType::String,
            required: true,
            min_length: 1,
            max_length: 500,
        });
        new_fields.push_back(MetadataFieldRule {
            name: String::from_str(env, "institution"),
            field_type: MetadataFieldType::String,
            required: true,
            min_length: 1,
            max_length: 200,
        });

        let mut required_fields = Vec::new(env);
        required_fields.push_back(String::from_str(env, "title"));
        required_fields.push_back(String::from_str(env, "courseName"));
        required_fields.push_back(String::from_str(env, "institution"));

        let new_schema = MetadataSchemaRecord {
            id: String::from_str(env, "schema-002"),
            name: String::from_str(env, "course-certificate"),
            version: MetadataSchemaVersion {
                major: 2,
                minor: 0,
                patch: 0,
            },
            fields: new_fields,
            required_fields,
            allow_custom_fields: true,
            created_by: creator.clone(),
            created_at: 2000,
            is_active: true,
            previous_version_id: Some(String::from_str(env, "schema-001")),
        };

        let old_id = String::from_str(env, "schema-001");
        assert!(upgrade_schema(env, &old_id, new_schema).is_ok());

        let old_schema = get_schema(env, &old_id).unwrap();
        assert!(!old_schema.is_active);

        let new_id = String::from_str(env, "schema-002");
        let new_schema = get_schema(env, &new_id).unwrap();
        assert!(new_schema.is_active);
        assert_eq!(new_schema.version.major, 2);
    });
}

#[test]
fn test_upgrade_with_lower_version_fails() {
    let h = Harness::new();
    let creator = h.actor();
    h.run(|| {
        let env = &h.env;
        let schema = create_test_schema(env, &creator);
        register_schema(env, schema.clone()).unwrap();

        let downgrade = MetadataSchemaRecord {
            id: String::from_str(env, "schema-bad"),
            version: MetadataSchemaVersion {
                major: 0,
                minor: 9,
                patch: 0,
            },
            ..schema
        };

        let old_id = String::from_str(env, "schema-001");
        let result = upgrade_schema(env, &old_id, downgrade);
        assert_eq!(result.err(), Some(MetadataError::InvalidVersion));
    });
}

#[test]
fn test_schema_history() {
    let h = Harness::new();
    let creator = h.actor();
    h.run(|| {
        let env = &h.env;
        let schema = create_test_schema(env, &creator);
        register_schema(env, schema).unwrap();

        let name = String::from_str(env, "course-certificate");
        let history = get_schema_history(env, &name);
        assert_eq!(history.len(), 1);
        assert_eq!(get_schema_count(env), 1);
    });
}

#[test]
fn test_version_comparison() {
    let v1 = MetadataSchemaVersion {
        major: 1,
        minor: 0,
        patch: 0,
    };
    let v2 = MetadataSchemaVersion {
        major: 2,
        minor: 0,
        patch: 0,
    };
    let v1_1 = MetadataSchemaVersion {
        major: 1,
        minor: 1,
        patch: 0,
    };
    let v1_copy = MetadataSchemaVersion {
        major: 1,
        minor: 0,
        patch: 0,
    };

    assert!(v2.is_greater_than(&v1));
    assert!(!v1.is_greater_than(&v2));
    assert!(v1_1.is_greater_than(&v1));
    assert!(v1.is_equal(&v1_copy));
    assert!(!v1.is_equal(&v2));
}

// ─── Storage layout (the actual bug) ─────────────────────────────────────────

/// Regression test for #759: a schema must land in its own `persistent()` entry
/// keyed by schema id, and nothing about it may be written to `instance()`.
/// `instance()` is a single ledger entry capped at ~16 KB in total, so keeping
/// schemas there is what made later writes fail once enough were registered.
#[test]
fn test_schemas_are_persistent_entries_keyed_by_schema_id_never_instance() {
    let h = Harness::new();
    let creator = h.actor();
    h.run(|| {
        let env = &h.env;
        let schema = create_test_schema(env, &creator);
        let id = schema.id.clone();
        let name = schema.name.clone();

        register_schema(env, schema).unwrap();

        // The schema is addressable by its id in persistent storage...
        assert!(env
            .storage()
            .persistent()
            .has(&MetadataKey::Schema(id.clone())));
        assert_eq!(get_schema(env, &id).unwrap().id, id);

        // ...and readable back through the public getter, while instance storage
        // holds none of it — neither under the typed key nor under the raw schema
        // id / name keys the old implementation wrote directly.
        assert!(!env
            .storage()
            .instance()
            .has(&MetadataKey::Schema(id.clone())));
        assert!(!env.storage().instance().has(&id));
        assert!(!env.storage().instance().has(&name));
        assert!(!env.storage().instance().has(&MetadataKey::SchemaCount));
        assert!(!env
            .storage()
            .instance()
            .has(&MetadataKey::SchemaHistory(name.clone())));
        assert!(!env
            .storage()
            .instance()
            .has(&MetadataKey::SchemaNameIndex(name)));
    });
}

/// The name index and the per-name history must be two different entries. They
/// previously shared the schema-name key: the index was written first and then
/// overwritten with the history list by the same call, so the index was never
/// readable and the history decoded as the wrong type.
#[test]
fn test_name_index_and_history_are_separate_entries_and_both_survive() {
    let h = Harness::new();
    let creator = h.actor();
    h.run(|| {
        let env = &h.env;
        let schema = create_test_schema(env, &creator);
        let name = schema.name.clone();
        let id = schema.id.clone();

        register_schema(env, schema).unwrap();

        // Both must be readable at the same time — the assertion that fails when
        // the two share one key.
        assert_eq!(get_latest_schema_id(env, &name), Some(id.clone()));
        assert_eq!(get_schema_history(env, &name).len(), 1);

        // After a second version under the same name, the index points at the
        // newest while the history keeps both, oldest first.
        let mut v2 = create_test_schema(env, &creator);
        v2.id = String::from_str(env, "schema-002");
        v2.version = MetadataSchemaVersion {
            major: 2,
            minor: 0,
            patch: 0,
        };
        let v2_id = v2.id.clone();
        register_schema(env, v2).unwrap();

        assert_eq!(get_latest_schema_id(env, &name), Some(v2_id.clone()));
        let history = get_schema_history(env, &name);
        assert_eq!(history.len(), 2);
        assert_eq!(history.get(0).unwrap(), id);
        assert_eq!(history.get(1).unwrap(), v2_id);
        assert_eq!(get_schema_count(env), 2);
    });
}

/// `upgrade_schema` deactivates the old version and registers the new one, so it
/// moves three entries: the deactivated record, the name index and the history.
#[test]
fn test_upgrade_updates_index_and_history_in_persistent_storage() {
    let h = Harness::new();
    let creator = h.actor();
    h.run(|| {
        let env = &h.env;
        let schema = create_test_schema(env, &creator);
        let name = schema.name.clone();
        register_schema(env, schema).unwrap();

        let mut v2 = create_test_schema(env, &creator);
        v2.id = String::from_str(env, "schema-002");
        v2.version = MetadataSchemaVersion {
            major: 2,
            minor: 0,
            patch: 0,
        };
        let v2_id = v2.id.clone();

        let old_id = String::from_str(env, "schema-001");
        upgrade_schema(env, &old_id, v2).unwrap();

        // Old record deactivated in its own persistent entry, and not in instance().
        assert!(!get_schema(env, &old_id).unwrap().is_active);
        assert!(!env
            .storage()
            .instance()
            .has(&MetadataKey::Schema(old_id.clone())));

        // New version is the latest for the name, and both versions are in history.
        assert_eq!(get_latest_schema_id(env, &name), Some(v2_id.clone()));
        assert_eq!(get_schema_history(env, &name).len(), 2);
        assert_eq!(get_schema_count(env), 2);
        assert!(get_schema(env, &v2_id).unwrap().is_active);
    });
}

/// The "hits the size limit rapidly" half of the issue as a volume test:
/// registering many schemas must keep working. With every schema, index and
/// history entry sharing the single ~16 KB `instance()` entry, this is exactly
/// the sequence that starts failing partway through.
#[test]
fn test_many_schemas_register_and_read_back_under_storage_pressure() {
    let h = Harness::new();
    let creator = h.actor();
    h.run(|| {
        let env = &h.env;

        const N: u32 = 60;
        for i in 0..N {
            let schema = bulk_schema(env, &creator, i);
            assert!(
                register_schema(env, schema).is_ok(),
                "register {} failed",
                i
            );
        }

        // Every schema is individually addressable and intact...
        for i in 0..N {
            let id = id_for(env, i);
            let fetched = get_schema(env, &id).unwrap();
            assert_eq!(fetched.version.major, i + 1);
            assert_eq!(fetched.fields.len(), 6);
        }

        // ...the count is right...
        assert_eq!(get_schema_count(env), N);

        // ...and nothing was ever written to instance(), which is what keeps the
        // ~16 KB cap out of the picture.
        let name = String::from_str(env, "course-certificate");
        assert!(!env.storage().instance().has(&MetadataKey::SchemaCount));
        assert!(!env.storage().instance().has(&name));
        assert_eq!(get_schema_history(env, &name).len(), N);

        // A fresh name starts its own history rather than joining the existing one.
        let fresh_name = String::from_str(env, "transcript");
        assert_eq!(get_schema_history(env, &fresh_name).len(), 0);
        assert_eq!(get_latest_schema_id(env, &fresh_name), None);
    });
}
