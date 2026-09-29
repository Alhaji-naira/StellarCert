#![no_std]
use soroban_sdk::{contract, contractimpl, Env, String, Symbol, Address};

// Assuming your certificate storage structure looks similar to this:
// #[contracttype]
// pub struct Certificate {
//     pub id: String,
//     pub owner: Address,
//     pub status: Symbol, // e.g., Symbol::new(&env, "Active")
//     pub internal_reason: String,
// }

#[contract]
pub struct CertificateContract;

#[contractimpl]
impl CertificateContract {
    /// Reissues a new certificate while atomically revoking the parent certificate to prevent coexistence.
    pub fn reissue_certificate(
        env: Env,
        admin: Address,
        original_id: String,
        new_id: String,
        new_metadata_uri: String,
    ) {
        admin.require_auth();

        // 1. Fetch and update the parent certificate to prevent simultaneous validity
        let mut original_cert: Certificate = env
            .storage()
            .persistent()
            .get(&original_id)
            .unwrap_or_else(|| panic!("Original certificate not found"));

        // Guard: Ensure the parent isn't already revoked
        if original_cert.status == Symbol::new(&env, "Revoked") {
            panic!("Cannot reissue from an already revoked certificate");
        }

        // Atomically transition the old certificate state
        original_cert.status = Symbol::new(&env, "Revoked");
        original_cert.internal_reason = String::from_str(&env, "Superseded");
        env.storage().persistent().set(&original_id, &original_cert);

        // 2. Emit an explicit revocation event for the original certificate
        #[allow(deprecated)]
        env.events().publish(
            (Symbol::new(&env, "CertificateRevokedEvent"), original_id.clone()),
            String::from_str(&env, "Superseded")
        );

        // 3. (Your existing logic) Initialize and store the new child certificate
        // let new_cert = Certificate { id: new_id.clone(), ... };
        // env.storage().persistent().set(&new_id, &new_cert);
        // env.events().publish((Symbol::new(&env, "CertificateIssuedEvent"), new_id), ...);
    }
}

#![no_std]
use soroban_sdk::{contract, contractimpl, Env, Address, panic_with_error};

#[contract]
pub struct CertificateContract;

#[contractimpl]
impl CertificateContract {
    /// Retrieves the multisig configuration safely by verifying the true caller's identity.
    pub fn get_multisig_config(env: Env, caller: Address) -> MultisigConfig {
        // FIXED: Force authentication on the actual address executing the transaction.
        // The transaction will fail instantly unless the entity calling this method signs it.
        caller.require_auth();

        // Optional: Ensure the authenticated caller has administrative privileges
        // let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        // if caller != admin {
        //     panic!("Unauthorized access to multisig configurations");
        // }

        env.storage()
            .instance()
            .get(&DataKey::MultisigConfig)
            .unwrap_or_else(|| panic!("Multisig configuration not initialized"))
    }
}

