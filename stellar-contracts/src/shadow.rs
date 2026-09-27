use soroban_sdk::{contracttype, Address, Env, IntoVal, String, Val, Vec};

use crate::persistent::extend_ttl;

/// Metadata field types supported by the schema
#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum MetadataFieldType {
    String = 0,
    Number = 1,
    Boolean = 2,
    Date = 3,
    Json = 4,
}

impl MetadataFieldType {
    pub fn from_u32(value: u32) -> Option<Self> {
        match value {
            0 => Some(MetadataFieldType::String),
            1 => Some(MetadataFieldType::Number),
            2 => Some(MetadataFieldType::Boolean),
            3 => Some(MetadataFieldType::Date),
            4 => Some(MetadataFieldType::Json),
            _ => None,
        }
    }
}

/// Schema version structure for tracking schema evolution
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MetadataSchemaVersion {
    pub major: u32,
    pub minor: u32,
    pub patch: u32,
}

impl MetadataSchemaVersion {
    pub fn is_greater_than(&self, other: &MetadataSchemaVersion) -> bool {
        if self.major > other.major {
            return true;
        }
        if self.major == other.major && self.minor > other.minor {
            return true;
        }
        if self.major == other.major && self.minor == other.minor && self.patch > other.patch {
            return true;
        }
        false
    }

    pub fn is_equal(&self, other: &MetadataSchemaVersion) -> bool {
        self.major == other.major && self.minor == other.minor && self.patch == other.patch
    }
}

/// A field rule defining constraints for a metadata field
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MetadataFieldRule {
    pub name: String,
    pub field_type: MetadataFieldType,
    pub required: bool,
    pub min_length: u32,
    pub max_length: u32,
}

/// A complete metadata schema record
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MetadataSchemaRecord {
    pub id: String,
    pub name: String,
    pub version: MetadataSchemaVersion,
    pub fields: Vec<MetadataFieldRule>,
    pub required_fields: Vec<String>,
    pub allow_custom_fields: bool,
    pub created_by: Address,
    pub created_at: u64,
    pub is_active: bool,
    pub previous_version_id: Option<String>,
}

/// A single metadata entry (key-value pair)
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MetadataEntry {
    pub key: String,
    pub value: String,
    pub value_type: MetadataFieldType,
}

/// Validation error structure
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MetadataValidationError {
    pub field: String,
    pub constraint: String,
    pub message: String,
}

/// Result of metadata validation
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MetadataValidationResult {
    pub valid: bool,
    pub errors: Vec<MetadataValidationError>,
}

/// Metadata-related errors
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum MetadataError {
    SchemaAlreadyExists = 0,
    SchemaNotFound = 1,
    SchemaInactive = 2,
    InvalidVersion = 3,
    ValidationFailed = 4,
    Unauthorized = 5,
}

/// Storage keys for metadata schemas.
///
/// Each variant is its own ledger entry. Only `SchemaCount` has a bounded size;
/// a schema record, the name index and the per-name history all grow with the
/// number of schemas (and with the size of each schema), so they live in
/// `persistent()` storage, one entry per key, instead of sharing `instance()`.
///
/// `instance()` storage is a **single** ledger entry with a fixed maximum size
/// (currently ~16 KB), so keeping the schemas there meant that once the
/// cumulative size of all schemas, name indexes and history lists crossed that
/// cap, every later `register_schema` / `upgrade_schema` write would fail for
/// good — the contract could never accept another schema. Because `instance()`
/// is also the entry holding the contract's own instance data, hitting the cap
/// risks the instance entry itself.
///
/// The name index and the history are deliberately **separate** variants: they
/// previously shared one key (a raw schema-name `String`), so registering a
/// schema wrote the id to the name key and then immediately overwrote it with
/// the history list, leaving the name index unreadable and the history
/// unreadable in the same write.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum MetadataKey {
    /// Schema id -> its `MetadataSchemaRecord`.
    Schema(String),
    /// Schema name -> id of the latest version registered under that name.
    SchemaNameIndex(String),
    /// Schema name -> every version registered under that name, oldest first.
    SchemaHistory(String),
    /// Total number of registered schemas.
    SchemaCount,
}

/// Write a value to persistent storage and top up its TTL, so a schema that is
/// written once does not silently expire while the contract is still serving it.
fn set_persistent<K, V>(env: &Env, key: &K, value: &V)
where
    K: IntoVal<Env, Val>,
    V: IntoVal<Env, Val>,
{
    env.storage().persistent().set(key, value);
    extend_ttl(env, key, None);
}

/// Register a new metadata schema
pub fn register_schema(env: &Env, schema: MetadataSchemaRecord) -> Result<(), MetadataError> {
    // Check if schema already exists
    let schema_key = MetadataKey::Schema(schema.id.clone());
    if env.storage().persistent().has(&schema_key) {
        return Err(MetadataError::SchemaAlreadyExists);
    }

    // Store the schema in its own persistent entry, keyed by schema id.
    set_persistent(env, &schema_key, &schema);

    // Point the name index at this schema: it is the latest version of that name.
    set_persistent(
        env,
        &MetadataKey::SchemaNameIndex(schema.name.clone()),
        &schema.id,
    );

    // Append to the per-name history. This used to write to the same key as the
    // name index, which destroyed the index on every registration.
    let history_key = MetadataKey::SchemaHistory(schema.name.clone());
    let mut history: Vec<String> = env
        .storage()
        .persistent()
        .get(&history_key)
        .unwrap_or_else(|| Vec::new(env));
    history.push_back(schema.id.clone());
    set_persistent(env, &history_key, &history);

    // Update schema count
    let count_key = MetadataKey::SchemaCount;
    let count: u32 = env.storage().persistent().get(&count_key).unwrap_or(0);
    set_persistent(env, &count_key, &(count + 1));

    Ok(())
}

/// Get a schema by ID
pub fn get_schema(env: &Env, id: &String) -> Option<MetadataSchemaRecord> {
    env.storage()
        .persistent()
        .get(&MetadataKey::Schema(id.clone()))
}

/// Get the total number of schemas
pub fn get_schema_count(env: &Env) -> u32 {
    env.storage()
        .persistent()
        .get(&MetadataKey::SchemaCount)
        .unwrap_or(0)
}

/// Get schema history by name
pub fn get_schema_history(env: &Env, name: &String) -> Vec<String> {
    env.storage()
        .persistent()
        .get(&MetadataKey::SchemaHistory(name.clone()))
        .unwrap_or_else(|| Vec::new(env))
}

/// Get the id of the latest schema registered under `name`
pub fn get_latest_schema_id(env: &Env, name: &String) -> Option<String> {
    env.storage()
        .persistent()
        .get(&MetadataKey::SchemaNameIndex(name.clone()))
}

/// Validate metadata against a schema
pub fn validate_metadata(
    env: &Env,
    schema_id: &String,
    entries: &Vec<MetadataEntry>,
    _cert_id: &String,
) -> MetadataValidationResult {
    let schema = match get_schema(env, schema_id) {
        Some(s) => s,
        None => {
            let mut errors: Vec<MetadataValidationError> = Vec::new(env);
            errors.push_back(MetadataValidationError {
                field: String::from_str(env, "schema"),
                constraint: String::from_str(env, "exists"),
                message: String::from_str(env, "Schema not found"),
            });
            return MetadataValidationResult {
                valid: false,
                errors,
            };
        }
    };

    // Check if schema is active
    if !schema.is_active {
        let mut errors: Vec<MetadataValidationError> = Vec::new(env);
        errors.push_back(MetadataValidationError {
            field: String::from_str(env, "schema"),
            constraint: String::from_str(env, "active"),
            message: String::from_str(env, "Schema is inactive"),
        });
        return MetadataValidationResult {
            valid: false,
            errors,
        };
    }

    let mut errors: Vec<MetadataValidationError> = Vec::new(env);

    // Check required fields
    for required_field in schema.required_fields.iter() {
        let found = entries.iter().any(|e| e.key == required_field);
        if !found {
            errors.push_back(MetadataValidationError {
                field: required_field.clone(),
                constraint: String::from_str(env, "required"),
                message: String::from_str(env, "Required field is missing"),
            });
        }
    }

    // Validate each entry
    for entry in entries.iter() {
        // Find matching field rule
        let field_rule = schema.fields.iter().find(|f| f.name == entry.key);

        if let Some(rule) = field_rule {
            // Check type match
            if rule.field_type != entry.value_type {
                errors.push_back(MetadataValidationError {
                    field: entry.key.clone(),
                    constraint: String::from_str(env, "type"),
                    message: String::from_str(env, "Field type mismatch"),
                });
            }

            // Check string length constraints for String type
            if entry.value_type == MetadataFieldType::String {
                let len = entry.value.len();
                if len < rule.min_length {
                    errors.push_back(MetadataValidationError {
                        field: entry.key.clone(),
                        constraint: String::from_str(env, "minLength"),
                        message: String::from_str(env, "Value too short"),
                    });
                }
                if len > rule.max_length {
                    errors.push_back(MetadataValidationError {
                        field: entry.key.clone(),
                        constraint: String::from_str(env, "maxLength"),
                        message: String::from_str(env, "Value too long"),
                    });
                }
            }
        } else {
            // No matching field rule found
            if !schema.allow_custom_fields {
                errors.push_back(MetadataValidationError {
                    field: entry.key.clone(),
                    constraint: String::from_str(env, "noCustomFields"),
                    message: String::from_str(env, "Custom fields not allowed"),
                });
            }
        }
    }

    MetadataValidationResult {
        valid: errors.is_empty(),
        errors,
    }
}

/// Upgrade a schema to a new version
pub fn upgrade_schema(
    env: &Env,
    old_id: &String,
    new_schema: MetadataSchemaRecord,
) -> Result<(), MetadataError> {
    // Get old schema
    let old_schema = match get_schema(env, old_id) {
        Some(s) => s,
        None => return Err(MetadataError::SchemaNotFound),
    };

    // Check version is greater
    if !new_schema.version.is_greater_than(&old_schema.version) {
        return Err(MetadataError::InvalidVersion);
    }

    // Deactivate old schema (persistent, like every other schema write)
    let mut deactivated = old_schema;
    deactivated.is_active = false;
    set_persistent(env, &MetadataKey::Schema(old_id.clone()), &deactivated);

    // Register new schema with link to old version
    let mut upgraded = new_schema;
    upgraded.previous_version_id = Some(old_id.clone());

    // Register the new schema
    register_schema(env, upgraded)
}
