use soroban_sdk::{contracterror, contracttype, vec, Address, Env, String, Vec};

/// Metadata field types supported by the schema
#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum MetadataFieldType {
    String,
    Number,
    Boolean,
    Date,
    Json,
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
#[contracterror]
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

/// Storage keys for metadata.
///
/// Each logical collection has its own namespaced variant so that a schema
/// record, the name index, the history list and the counter can never collide
/// in the same ledger entry.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum MetadataKey {
    /// A schema record, keyed by schema ID.
    Schema(String),
    /// Maps a schema name to its latest schema ID.
    SchemaNameIndex(String),
    /// Maps a schema name to the ordered list of its schema IDs.
    SchemaHistory(String),
    /// Total number of registered schemas.
    SchemaCount,
}

/// Register a new metadata schema.
///
/// Schemas are written to `persistent()` storage keyed by schema ID. Instance
/// storage is a single ledger entry capped at ~16 KB, so keeping schemas there
/// would exhaust it and cause all later writes to fail (#759). Persistent
/// entries are independent and can be TTL-managed per schema.
pub fn register_schema(env: &Env, schema: MetadataSchemaRecord) -> Result<(), MetadataError> {
    let schema_key = MetadataKey::Schema(schema.id.clone());
    if env.storage().persistent().has(&schema_key) {
        return Err(MetadataError::SchemaAlreadyExists);
    }

    // Store the schema itself, keyed by its unique ID.
    env.storage().persistent().set(&schema_key, &schema);
    crate::persistent::extend_ttl(env, &schema_key, None);

    // Point the name index at the latest schema ID for this name.
    let index_key = MetadataKey::SchemaNameIndex(schema.name.clone());
    env.storage().persistent().set(&index_key, &schema.id);
    crate::persistent::extend_ttl(env, &index_key, None);

    // Update the global schema count.
    let count_key = MetadataKey::SchemaCount;
    let count: u32 = env.storage().persistent().get(&count_key).unwrap_or(0);
    env.storage().persistent().set(&count_key, &(count + 1));
    crate::persistent::extend_ttl(env, &count_key, None);

    // Append the schema ID to this name's history list. This uses a dedicated
    // key so it no longer shares an entry with the name index above.
    let history_key = MetadataKey::SchemaHistory(schema.name.clone());
    let mut history: Vec<String> = env
        .storage()
        .persistent()
        .get(&history_key)
        .unwrap_or_else(|| Vec::new(env));
    history.push_back(schema.id.clone());
    env.storage().persistent().set(&history_key, &history);
    crate::persistent::extend_ttl(env, &history_key, None);

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
            return MetadataValidationResult {
                valid: false,
                errors: vec![
                    &env,
                    MetadataValidationError {
                        field: String::from_str(env, "schema"),
                        constraint: String::from_str(env, "exists"),
                        message: String::from_str(env, "Schema not found"),
                    },
                ],
            };
        }
    };

    // Check if schema is active
    if !schema.is_active {
        return MetadataValidationResult {
            valid: false,
            errors: vec![
                &env,
                MetadataValidationError {
                    field: String::from_str(env, "schema"),
                    constraint: String::from_str(env, "active"),
                    message: String::from_str(env, "Schema is inactive"),
                },
            ],
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

    // Deactivate the previous version in persistent storage.
    let mut deactivated = old_schema;
    deactivated.is_active = false;
    let old_key = MetadataKey::Schema(old_id.clone());
    env.storage().persistent().set(&old_key, &deactivated);
    crate::persistent::extend_ttl(env, &old_key, None);

    // Register new schema with link to old version
    let mut upgraded = new_schema.clone();
    upgraded.previous_version_id = Some(old_id.clone());

    // Register the new schema
    register_schema(env, upgraded)
}
