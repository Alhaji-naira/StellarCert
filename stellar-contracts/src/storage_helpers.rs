use soroban_sdk::{Env, Address};
use crate::storage::{StorageKey, CoreDataKey, AdminDataKey};

pub fn set_admin(env: &Env, admin: &Address) {
    env.storage().set(
        &StorageKey::Core(CoreDataKey::Admin),
        admin,
    );
}

pub fn get_admin(env: &Env) -> Address {
    env.storage()
        .get(&StorageKey::Core(CoreDataKey::Admin))
        .unwrap()
}

pub fn set_owners(env: &Env, owners: &Vec<Address>) {
    env.storage().set(
        &StorageKey::Admin(AdminDataKey::Owners),
        owners,
    );
}
