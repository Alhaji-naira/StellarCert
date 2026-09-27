#![no_std]

use soroban_sdk::{Address, Env, String, Vec};

/// Metadata field types supported by the schema
#[derive(Clone, Copy, PartialEq, Eq)]
#[repr(u32)]
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
#[derive(Clone)]
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
        if self.major == other.major
            && self.minor == other.minor
            && self.patch > other.patch
        {
            return true;
        }
        false
    }

    pub fn is_equal(&self, other: &MetadataSchemaVersion) -> bool {
        self.major == other.major && self.minor == other.minor && self.patch == other.patch
    }
}

/// A field rule defining constraints for a metadata field
#[derive(Clone)]
pub struct MetadataFieldRule {
    pub name: String,
    pub field_type: MetadataFieldType,
    pub required: bool,
    pub min_length: u32,
    pub max_length: u32,
}

/// A complete metadata schema record
#[derive(Clone)]
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
#[derive(Clone)]
pub struct MetadataEntry {
    pub key: String,
    pub value: String,
    pub value_type: MetadataFieldType,
}

/// Validation error structure
#[derive(Clone)]
pub struct MetadataValidationError {
    pub field: String,
    pub constraint: String,
    pub message: String,
}

/// Result of metadata validation
#[derive(Clone)]
pub struct MetadataValidationResult {
    pub valid: bool,
    pub errors: Vec<MetadataValidationError>,
}

/// Metadata-related errors
#[derive(Clone, Copy, PartialEq, Eq)]
#[repr(u32)]
pub enum MetadataError {
    SchemaAlreadyExists = 0,
    SchemaNotFound = 1,
    SchemaInactive = 2,
    InvalidVersion = 3,
    ValidationFailed = 4,
    Unauthorized = 5,
}

/// Storage keys for metadata
#[derive(Clone)]
pub enum MetadataKey {
    Schema(String),
    SchemaNameIndex(String), // Maps schema name to latest schema ID
    SchemaHistory(String),   // Maps schema name to list of schema IDs
    SchemaCount,
}

// Implement conversion for MetadataKey to be used as storage key
impl MetadataKey {
    pub fn to_key(&self) -> soroban_sdk::storage::Key {
        match self {
            MetadataKey::Schema(id) => {
                soroban_sdk::storage::Key::try_from_val(&soroban_sdk::Symbol::from_str("md_sch"), id)
                    .unwrap_or_else(|_| soroban_sdk::storage::Key::try_from_val(&0u32, id).unwrap())
            }
            MetadataKey::SchemaNameIndex(name) => {
                soroban_sdk::storage::Key::try_from_val(&soroban_sdk::Symbol::from_str("md_nidx"), name)
                    .unwrap_or_else(|_| soroban_sdk::storage::Key::try_from_val(&1u32, name).unwrap())
            }
            MetadataKey::SchemaHistory(name) => {
                soroban_sdk::storage::Key::try_from_val(&soroban_sdk::Symbol::from_str("md_hist"), name)
                    .unwrap_or_else(|_| soroban_sdk::storage::Key::try_from_val(&2u32, name).unwrap())
            }
            MetadataKey::SchemaCount => {
                soroban_sdk::storage::Key::try_from_val(&soroban_sdk::Symbol::from_str("md_cnt"), &())
                    .unwrap_or_else(|_| soroban_sdk::storage::Key::try_from_val(&3u32, &()).unwrap())
            }
        }
    }
}

/// Register a new metadata schema
pub fn register_schema(env: &Env, schema: MetadataSchemaRecord) -> Result<(), MetadataError> {
    // Check if schema already exists
    if env
        .storage()
        .instance()
        .has(&schema.id)
    {
        return Err(MetadataError::SchemaAlreadyExists);
    }

    // Store the schema
    env.storage()
        .instance()
        .set(&schema.id, &schema);

    // Update name index to point to this schema
    env.storage()
        .instance()
        .set(&MetadataKey::SchemaNameIndex(schema.name.clone()), &schema.id);

    // Update schema count
    let count: u32 = env
        .storage()
        .instance()
        .get(&MetadataKey::SchemaCount)
        .unwrap_or(0);
    env.storage()
        .instance()
        .set(&MetadataKey::SchemaCount, &(count + 1));

    // Initialize schema history if needed
    let mut history: Vec<String> = env
        .storage()
        .instance()
        .get(&MetadataKey::SchemaHistory(schema.name.clone()))
        .unwrap_or_else(|| Vec::new(env));
    history.push_back(schema.id.clone());
    env.storage()
        .instance()
        .set(&MetadataKey::SchemaHistory(schema.name.clone()), &history);

    Ok(())
}

/// Get a schema by ID
pub fn get_schema(env: &Env, id: &String) -> Option<MetadataSchemaRecord> {
    env.storage().instance().get(id)
}

/// Get the total number of schemas
pub fn get_schema_count(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&MetadataKey::SchemaCount)
        .unwrap_or(0)
}

/// Get schema history by name
pub fn get_schema_history(env: &Env, name: &String) -> Vec<String> {
    env.storage()
        .instance()
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
                errors: vec![MetadataValidationError {
                    field: String::from_str(env, "schema"),
                    constraint: String::from_str(env, "exists"),
                    message: String::from_str(env, "Schema not found"),
                }],
            };
        }
    };

    // Check if schema is active
    if !schema.is_active {
        return MetadataValidationResult {
            valid: false,
            errors: vec![MetadataValidationError {
                field: String::from_str(env, "schema"),
                constraint: String::from_str(env, "active"),
                message: String::from_str(env, "Schema is inactive"),
            }],
        };
    }

    let mut errors: Vec<MetadataValidationError> = Vec::new(env);

    // Check required fields
    for required_field in schema.required_fields.iter() {
        let found = entries.iter().any(|e| e.key == required_field);
        if !found {
            errors.push(MetadataValidationError {
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
                errors.push(MetadataValidationError {
                    field: entry.key.clone(),
                    constraint: String::from_str(env, "type"),
                    message: String::from_str(env, "Field type mismatch"),
                });
            }

            // Check string length constraints for String type
            if entry.value_type == MetadataFieldType::String {
                let len = entry.value.len();
                if len < rule.min_length as u32 {
                    errors.push(MetadataValidationError {
                        field: entry.key.clone(),
                        constraint: String::from_str(env, "minLength"),
                        message: String::from_str(env, "Value too short"),
                    });
                }
                if len > rule.max_length as u32 {
                    errors.push(MetadataValidationError {
                        field: entry.key.clone(),
                        constraint: String::from_str(env, "maxLength"),
                        message: String::from_str(env, "Value too long"),
                    });
                }
            }
        } else {
            // No matching field rule found
            if !schema.allow_custom_fields {
                errors.push(MetadataValidationError {
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

    // Deactivate old schema
    let mut deactivated = old_schema;
    deactivated.is_active = false;
    env.storage()
        .instance()
        .set(old_id, &deactivated);

    // Register new schema with link to old version
    let mut upgraded = new_schema.clone();
    upgraded.previous_version_id = Some(old_id.clone());

    // Register the new schema
    register_schema(env, upgraded)
}
