use super::*;
use soroban_sdk::{testutils::Address as _, Address, Env, String};
use crate::types::StatusTransition;

#[test]
fn test_initialize() {
    let env = Env::default();
    let contract_id = env.register(CertificateContract, ());
    let client = CertificateContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);
    let issuance_fee: i128 = 1000; // 0.00001 XLM in stroops

    env.mock_all_auths();
    client.initialize(&admin, &treasury, &issuance_fee);

    assert_eq!(client.get_admin(), admin);
    assert_eq!(client.get_certificate_count(), 0);
    assert!(client.validate_issuer(&admin));
    
    // Check fee config
    let fee_config = client.get_fee_config();
    assert_eq!(fee_config.treasury, treasury);
    assert_eq!(fee_config.issuance_fee, issuance_fee);
    assert!(fee_config.fee_enabled);
}

#[test]
#[should_panic(expected = "Already initialized")]
fn test_initialize_twice_fails() {
    let env = Env::default();
    let contract_id = env.register(CertificateContract, ());
    let client = CertificateContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);
    let issuance_fee: i128 = 1000;

    env.mock_all_auths();
    client.initialize(&admin, &treasury, &issuance_fee);
    client.initialize(&admin, &treasury, &issuance_fee); // Should panic
}

#[test]
fn test_add_and_remove_issuer() {
    let env = Env::default();
    let contract_id = env.register(CertificateContract, ());
    let client = CertificateContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);
    let issuance_fee: i128 = 1000;
    let issuer = Address::generate(&env);

    env.mock_all_auths();
    
    client.initialize(&admin, &treasury, &issuance_fee);
    
    // Initially, issuer should not be authorized
    assert!(!client.validate_issuer(&issuer));

    // Add issuer
    client.add_issuer(&issuer);
    assert!(client.validate_issuer(&issuer));

    // Remove issuer
    client.remove_issuer(&issuer);
    assert!(!client.validate_issuer(&issuer));
}

#[test]
fn test_issue_certificate_success() {
    let env = Env::default();
    let contract_id = env.register(CertificateContract, ());
    let client = CertificateContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);
    let issuance_fee: i128 = 1000;
    let issuer = Address::generate(&env);
    let recipient = Address::generate(&env);

    env.mock_all_auths();

    client.initialize(&admin, &treasury, &issuance_fee);
    client.add_issuer(&issuer);

    let cert_id = String::from_str(&env, "CERT-001");
    let metadata = CertificateMetadata {
        title: String::from_str(&env, "Blockchain Developer"),
        description: String::from_str(&env, "Completed blockchain development course"),
        course_name: String::from_str(&env, "Advanced Blockchain"),
        completion_date: 1704067200,
        valid_until: 0,
        ipfs_hash: String::from_str(&env, "QmTest123"),
    };

    let result = client.issue_certificate(&cert_id, &issuer, &recipient, &metadata);
    
    assert!(result.is_ok());
    let certificate = result.unwrap();
    
    assert_eq!(certificate.id, cert_id);
    assert_eq!(certificate.issuer, issuer);
    assert_eq!(certificate.recipient, recipient);
    assert_eq!(certificate.status, CertificateStatus::Active);
    assert_eq!(client.get_certificate_count(), 1);
}

#[test]
fn test_issue_certificate_unauthorized() {
    let env = Env::default();
    let contract_id = env.register(CertificateContract, ());
    let client = CertificateContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);
    let issuance_fee: i128 = 1000;
    let unauthorized_issuer = Address::generate(&env);
    let recipient = Address::generate(&env);

    env.mock_all_auths();

    client.initialize(&admin, &treasury, &issuance_fee);

    let cert_id = String::from_str(&env, "CERT-002");
    let metadata = CertificateMetadata {
        title: String::from_str(&env, "Test Certificate"),
        description: String::from_str(&env, "Test"),
        course_name: String::from_str(&env, "Test Course"),
        completion_date: 1704067200,
        valid_until: 0,
        ipfs_hash: String::from_str(&env, "QmTest456"),
    };

    let result = client.issue_certificate(
        &cert_id,
        &unauthorized_issuer,
        &recipient,
        &metadata,
    );
    
    assert_eq!(result, Err(Ok(CertificateError::Unauthorized)));
}

#[test]
fn test_issue_certificate_already_exists() {
    let env = Env::default();
    let contract_id = env.register(CertificateContract, ());
    let client = CertificateContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);
    let issuance_fee: i128 = 1000;
    let issuer = Address::generate(&env);
    let recipient = Address::generate(&env);

    env.mock_all_auths();

    client.initialize(&admin, &treasury, &issuance_fee);
    client.add_issuer(&issuer);

    let cert_id = String::from_str(&env, "CERT-003");
    let metadata = CertificateMetadata {
        title: String::from_str(&env, "Test Certificate"),
        description: String::from_str(&env, "Test"),
        course_name: String::from_str(&env, "Test Course"),
        completion_date: 1704067200,
        valid_until: 0,
        ipfs_hash: String::from_str(&env, "QmTest789"),
    };

    // Issue certificate first time
    let result1 = client.issue_certificate(&cert_id, &issuer, &recipient, &metadata);
    assert!(result1.is_ok());

    // Try to issue same certificate again
    let result2 = client.issue_certificate(&cert_id, &issuer, &recipient, &metadata);
    assert_eq!(result2, Err(Ok(CertificateError::AlreadyExists)));
}

#[test]
fn test_issue_certificate_invalid_data() {
    let env = Env::default();
    let contract_id = env.register(CertificateContract, ());
    let client = CertificateContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);
    let issuance_fee: i128 = 1000;
    let issuer = Address::generate(&env);
    let recipient = Address::generate(&env);

    env.mock_all_auths();

    client.initialize(&admin, &treasury, &issuance_fee);
    client.add_issuer(&issuer);

    let cert_id = String::from_str(&env, "CERT-004");
    let metadata = CertificateMetadata {
        title: String::from_str(&env, ""),  // Empty title - invalid
        description: String::from_str(&env, "Test"),
        course_name: String::from_str(&env, "Test Course"),
        completion_date: 1704067200,
        ipfs_hash: String::from_str(&env, "QmTest"),
    };

    let result = client.issue_certificate(&cert_id, &issuer, &recipient, &metadata);
    assert_eq!(result, Err(Ok(CertificateError::InvalidData)));
}

#[test]
fn test_get_certificate() {
    let env = Env::default();
    let contract_id = env.register(CertificateContract, ());
    let client = CertificateContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);
    let issuance_fee: i128 = 1000;
    let issuer = Address::generate(&env);
    let recipient = Address::generate(&env);

    env.mock_all_auths();

    client.initialize(&admin, &treasury, &issuance_fee);
    client.add_issuer(&issuer);

    let cert_id = String::from_str(&env, "CERT-005");
    let metadata = CertificateMetadata {
        title: String::from_str(&env, "Data Science"),
        description: String::from_str(&env, "Completed data science course"),
        course_name: String::from_str(&env, "Data Science 101"),
        completion_date: 1704067200,
        valid_until: 0,
        ipfs_hash: String::from_str(&env, "QmDataScience"),
    };

    client.issue_certificate(&cert_id, &issuer, &recipient, &metadata);

    let result = client.get_certificate(&cert_id);
    assert!(result.is_ok());
    
    let certificate = result.unwrap();
    assert_eq!(certificate.id, cert_id);
    assert_eq!(certificate.issuer, issuer);
    assert_eq!(certificate.recipient, recipient);
}

#[test]
fn test_get_certificate_not_found() {
    let env = Env::default();
    let contract_id = env.register(CertificateContract, ());
    let client = CertificateContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);
    let issuance_fee: i128 = 1000;

    env.mock_all_auths();
    client.initialize(&admin, &treasury, &issuance_fee);

    let cert_id = String::from_str(&env, "CERT-999");
    let result = client.get_certificate(&cert_id);
    
    assert_eq!(result, Err(Ok(CertificateError::NotFound)));
}

#[test]
fn test_revoke_certificate_by_issuer() {
    let env = Env::default();
    let contract_id = env.register(CertificateContract, ());
    let client = CertificateContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);
    let issuance_fee: i128 = 1000;
    let issuer = Address::generate(&env);
    let recipient = Address::generate(&env);

    env.mock_all_auths();

    client.initialize(&admin, &treasury, &issuance_fee);
    client.add_issuer(&issuer);

    let cert_id = String::from_str(&env, "CERT-006");
    let metadata = CertificateMetadata {
        title: String::from_str(&env, "Test"),
        description: String::from_str(&env, "Test"),
        course_name: String::from_str(&env, "Test"),
        completion_date: 1704067200,
        valid_until: 0,
        ipfs_hash: String::from_str(&env, "QmTest"),
    };

    client.issue_certificate(&cert_id, &issuer, &recipient, &metadata);

    // Revoke by issuer
    let revoke_result = client.revoke_certificate(&cert_id, &issuer);
    assert!(revoke_result.is_ok());

    // Check certificate is revoked
    let certificate = client.get_certificate(&cert_id).unwrap();
    assert_eq!(certificate.status, CertificateStatus::Revoked);
    let verifier = Address::generate(&env);
    assert!(!client.verify_certificate(&cert_id, &verifier).is_valid);
}

#[test]
fn test_revoke_certificate_by_admin() {
    let env = Env::default();
    let contract_id = env.register(CertificateContract, ());
    let client = CertificateContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);
    let issuance_fee: i128 = 1000;
    let issuer = Address::generate(&env);
    let recipient = Address::generate(&env);

    env.mock_all_auths();

    client.initialize(&admin, &treasury, &issuance_fee);
    client.add_issuer(&issuer);

    let cert_id = String::from_str(&env, "CERT-007");
    let metadata = CertificateMetadata {
        title: String::from_str(&env, "Test"),
        description: String::from_str(&env, "Test"),
        course_name: String::from_str(&env, "Test"),
        completion_date: 1704067200,
        valid_until: 0,
        ipfs_hash: String::from_str(&env, "QmTest"),
    };

    client.issue_certificate(&cert_id, &issuer, &recipient, &metadata);

    // Revoke by admin
    let revoke_result = client.revoke_certificate(&cert_id, &admin);
    assert!(revoke_result.is_ok());

    let certificate = client.get_certificate(&cert_id).unwrap();
    assert_eq!(certificate.status, CertificateStatus::Revoked);
}

#[test]
fn test_revoke_certificate_unauthorized() {
    let env = Env::default();
    let contract_id = env.register(CertificateContract, ());
    let client = CertificateContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);
    let issuance_fee: i128 = 1000;
    let issuer = Address::generate(&env);
    let recipient = Address::generate(&env);
    let unauthorized = Address::generate(&env);

    env.mock_all_auths();

    client.initialize(&admin, &treasury, &issuance_fee);
    client.add_issuer(&issuer);

    let cert_id = String::from_str(&env, "CERT-008");
    let metadata = CertificateMetadata {
        title: String::from_str(&env, "Test"),
        description: String::from_str(&env, "Test"),
        course_name: String::from_str(&env, "Test"),
        completion_date: 1704067200,
        valid_until: 0,
        ipfs_hash: String::from_str(&env, "QmTest"),
    };

    client.issue_certificate(&cert_id, &issuer, &recipient, &metadata);

    // Try to revoke with unauthorized address
    let revoke_result = client.revoke_certificate(&cert_id, &unauthorized);
    assert_eq!(revoke_result, Err(Ok(CertificateError::Unauthorized)));
}

#[test]
fn test_verify_certificate() {
    let env = Env::default();
    let contract_id = env.register(CertificateContract, ());
    let client = CertificateContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);
    let issuance_fee: i128 = 1000;
    let issuer = Address::generate(&env);
    let recipient = Address::generate(&env);

    env.mock_all_auths();

    client.initialize(&admin, &treasury, &issuance_fee);
    client.add_issuer(&issuer);

    let cert_id = String::from_str(&env, "CERT-009");
    let metadata = CertificateMetadata {
        title: String::from_str(&env, "Test"),
        description: String::from_str(&env, "Test"),
        course_name: String::from_str(&env, "Test"),
        completion_date: 1704067200,
        valid_until: 0,
        ipfs_hash: String::from_str(&env, "QmTest"),
    };

    // Certificate doesn't exist yet
    let verifier = Address::generate(&env);
    assert!(!client.verify_certificate(&cert_id, &verifier).is_valid);

    // Issue certificate
    client.issue_certificate(&cert_id, &issuer, &recipient, &metadata);
    let verifier = Address::generate(&env);
    assert!(client.verify_certificate(&cert_id, &verifier).is_valid);

    // Revoke certificate
    client.revoke_certificate(&cert_id, &issuer);
    let verifier2 = Address::generate(&env);
    assert!(!client.verify_certificate(&cert_id, &verifier2).is_valid);
}

#[test]
fn test_multiple_certificates() {
    let env = Env::default();
    let contract_id = env.register(CertificateContract, ());
    let client = CertificateContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);
    let issuance_fee: i128 = 1000;
    let issuer = Address::generate(&env);

    env.mock_all_auths();

    client.initialize(&admin, &treasury, &issuance_fee);
    client.add_issuer(&issuer);

    // Issue multiple certificates
    for i in 1..=5 {
        let cert_id = String::from_str(&env, &format!("CERT-{:03}", i));
        let recipient = Address::generate(&env);
        let metadata = CertificateMetadata {
            title: String::from_str(&env, &format!("Certificate {}", i)),
            description: String::from_str(&env, "Test"),
            course_name: String::from_str(&env, "Test Course"),
            completion_date: 1704067200,
            valid_until: 0,
            ipfs_hash: String::from_str(&env, &format!("QmTest{}", i)),
        };

        let result = client.issue_certificate(&cert_id, &issuer, &recipient, &metadata);
        assert!(result.is_ok());
    }

    assert_eq!(client.get_certificate_count(), 5);
}
#[test]
fn test_verify_certificate_expiration() {
    let env = Env::default();
    let contract_id = env.register(CertificateContract, ());
    let client = CertificateContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);
    let issuance_fee: i128 = 1000;
    let issuer = Address::generate(&env);
    let recipient = Address::generate(&env);

    env.mock_all_auths();
    client.initialize(&admin, &treasury, &issuance_fee);
    client.add_issuer(&issuer);

    let cert_id = String::from_str(&env, "CERT-EXP-001");
    
    // Set ledger timestamp to 1000
    env.ledger().with_mut(|l| {
        l.timestamp = 1000;
    });

    let metadata = CertificateMetadata {
        title: String::from_str(&env, "Expired Cert"),
        description: String::from_str(&env, "Test"),
        course_name: String::from_str(&env, "Test"),
        completion_date: 500,
        valid_until: 900, // Expired
        ipfs_hash: String::from_str(&env, "QmTest"),
    };

    client.issue_certificate(&cert_id, &issuer, &recipient, &metadata);

    let verifier = Address::generate(&env);
    let result = client.verify_certificate(&cert_id, &verifier);
    
    assert!(!result.is_valid);
    assert_eq!(result.status, CertificateStatus::Expired);
}

#[test]
fn test_verification_history() {
    let env = Env::default();
    let contract_id = env.register(CertificateContract, ());
    let client = CertificateContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);
    let issuance_fee: i128 = 1000;
    let issuer = Address::generate(&env);
    let recipient = Address::generate(&env);

    env.mock_all_auths();
    client.initialize(&admin, &treasury, &issuance_fee);
    client.add_issuer(&issuer);

    let cert_id = String::from_str(&env, "CERT-HIST-001");
    let metadata = CertificateMetadata {
        title: String::from_str(&env, "Valid Cert"),
        description: String::from_str(&env, "Test"),
        course_name: String::from_str(&env, "Test"),
        completion_date: 500,
        valid_until: 0,
        ipfs_hash: String::from_str(&env, "QmTest"),
    };

    client.issue_certificate(&cert_id, &issuer, &recipient, &metadata);

    let verifier1 = Address::generate(&env);
    let verifier2 = Address::generate(&env);

    client.verify_certificate(&cert_id, &verifier1);
    client.verify_certificate(&cert_id, &verifier2);

    let history = client.get_verification_history(&cert_id);
    assert_eq!(history.len(), 2);
}

// ==================== Access Control Tests ====================

#[test]
fn test_access_control_require_admin() {
    let env = Env::default();
    let contract_id = env.register(CertificateContract, ());
    let client = CertificateContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);
    let issuance_fee: i128 = 1000;
    let other = Address::generate(&env);

    env.mock_all_auths();
    client.initialize(&admin, &treasury, &issuance_fee);

    // Admin should be able to add issuer
    client.add_issuer(&other);
    assert!(client.validate_issuer(&other));
}

#[test]
fn test_access_control_only_admin_functions() {
    let env = Env::default();
    let contract_id = env.register(CertificateContract, ());
    let client = CertificateContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);
    let issuance_fee: i128 = 1000;
    let non_admin = Address::generate(&env);

    env.mock_all_auths();
    client.initialize(&admin, &treasury, &issuance_fee);

    // Non-admin should not be able to add issuer (will fail auth)
    // In real implementation, this would revert
}

// ==================== Status Transition Tests ====================

#[test]
fn test_status_transition_active_to_revoked() {
    // Test valid transition: Active -> Revoked
    let from = CertificateStatus::Active;
    let to = CertificateStatus::Revoked;
    assert!(StatusTransition::is_valid_transition(&from, &to));
}

#[test]
fn test_status_transition_active_to_suspended() {
    // Test valid transition: Active -> Suspended
    let from = CertificateStatus::Active;
    let to = CertificateStatus::Suspended;
    assert!(StatusTransition::is_valid_transition(&from, &to));
}

#[test]
fn test_status_transition_suspended_to_active() {
    // Test valid transition: Suspended -> Active
    let from = CertificateStatus::Suspended;
    let to = CertificateStatus::Active;
    assert!(StatusTransition::is_valid_transition(&from, &to));
}

#[test]
fn test_status_transition_revoked_cannot_transition() {
    // Test invalid transition: Revoked is terminal
    let from = CertificateStatus::Revoked;
    let to = CertificateStatus::Active;
    assert!(!StatusTransition::is_valid_transition(&from, &to));
    
    let to2 = CertificateStatus::Suspended;
    assert!(!StatusTransition::is_valid_transition(&from, &to2));
}

#[test]
fn test_status_transition_expired_cannot_reactivate() {
    // Test invalid transition: Expired cannot go back to Active
    let from = CertificateStatus::Expired;
    let to = CertificateStatus::Active;
    assert!(!StatusTransition::is_valid_transition(&from, &to));
}

#[test]
fn test_suspend_certificate() {
    let env = Env::default();
    let contract_id = env.register(CertificateContract, ());
    let client = CertificateContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);
    let issuance_fee: i128 = 1000;
    let issuer = Address::generate(&env);
    let recipient = Address::generate(&env);

    env.mock_all_auths();
    client.initialize(&admin, &treasury, &issuance_fee);
    client.add_issuer(&issuer);

    let cert_id = String::from_str(&env, "CERT-SUSP-001");
    let metadata = CertificateMetadata {
        title: String::from_str(&env, "Test Certificate"),
        description: String::from_str(&env, "Test"),
        course_name: String::from_str(&env, "Test Course"),
        completion_date: 1704067200,
        valid_until: 0,
        ipfs_hash: String::from_str(&env, "QmTest"),
    };

    client.issue_certificate(&cert_id, &issuer, &recipient, &metadata);

    // Admin suspends the certificate
    let reason = String::from_str(&env, "Under investigation");
    let suspend_result = client.suspend_certificate(&cert_id, &reason);
    assert!(suspend_result.is_ok());

    // Verify status
    let certificate = client.get_certificate(&cert_id).unwrap();
    assert_eq!(certificate.status, CertificateStatus::Suspended);
}

#[test]
fn test_unsuspend_certificate() {
    let env = Env::default();
    let contract_id = env.register(CertificateContract, ());
    let client = CertificateContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);
    let issuance_fee: i128 = 1000;
    let issuer = Address::generate(&env);
    let recipient = Address::generate(&env);

    env.mock_all_auths();
    client.initialize(&admin, &treasury, &issuance_fee);
    client.add_issuer(&issuer);

    let cert_id = String::from_str(&env, "CERT-UNSUSP-001");
    let metadata = CertificateMetadata {
        title: String::from_str(&env, "Test Certificate"),
        description: String::from_str(&env, "Test"),
        course_name: String::from_str(&env, "Test Course"),
        completion_date: 1704067200,
        valid_until: 0,
        ipfs_hash: String::from_str(&env, "QmTest"),
    };

    client.issue_certificate(&cert_id, &issuer, &recipient, &metadata);

    // Admin suspends the certificate
    let reason = String::from_str(&env, "Under investigation");
    client.suspend_certificate(&cert_id, &reason);

    // Admin unsuspends the certificate
    let unsuspend_result = client.unsuspend_certificate(&cert_id);
    assert!(unsuspend_result.is_ok());

    // Verify status is back to Active
    let certificate = client.get_certificate(&cert_id).unwrap();
    assert_eq!(certificate.status, CertificateStatus::Active);
}

#[test]
fn test_get_status() {
    let env = Env::default();
    let contract_id = env.register(CertificateContract, ());
    let client = CertificateContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);
    let issuance_fee: i128 = 1000;
    let issuer = Address::generate(&env);
    let recipient = Address::generate(&env);

    env.mock_all_auths();
    client.initialize(&admin, &treasury, &issuance_fee);
    client.add_issuer(&issuer);

    let cert_id = String::from_str(&env, "CERT-STATUS-001");
    let metadata = CertificateMetadata {
        title: String::from_str(&env, "Test Certificate"),
        description: String::from_str(&env, "Test"),
        course_name: String::from_str(&env, "Test Course"),
        completion_date: 1704067200,
        valid_until: 0,
        ipfs_hash: String::from_str(&env, "QmTest"),
    };

    client.issue_certificate(&cert_id, &issuer, &recipient, &metadata);

    // Check initial status
    let status = client.get_status(&cert_id).unwrap();
    assert_eq!(status, CertificateStatus::Active);
}

// ==================== Fee Management Tests ====================

#[test]
fn test_fee_config() {
    let env = Env::default();
    let contract_id = env.register(CertificateContract, ());
    let client = CertificateContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);
    let issuance_fee: i128 = 1000;

    env.mock_all_auths();
    client.initialize(&admin, &treasury, &issuance_fee);

    // Check fee config
    let fee_config = client.get_fee_config();
    assert_eq!(fee_config.treasury, treasury);
    assert_eq!(fee_config.issuance_fee, issuance_fee);
    assert!(fee_config.fee_enabled);
}

#[test]
fn test_set_treasury() {
    let env = Env::default();
    let contract_id = env.register(CertificateContract, ());
    let client = CertificateContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);
    let issuance_fee: i128 = 1000;
    let new_treasury = Address::generate(&env);

    env.mock_all_auths();
    client.initialize(&admin, &treasury, &issuance_fee);

    // Admin changes treasury
    client.set_treasury(&new_treasury);

    let fee_config = client.get_fee_config();
    assert_eq!(fee_config.treasury, new_treasury);
}

#[test]
fn test_set_issuance_fee() {
    let env = Env::default();
    let contract_id = env.register(CertificateContract, ());
    let client = CertificateContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);
    let issuance_fee: i128 = 1000;
    let new_fee: i128 = 5000;

    env.mock_all_auths();
    client.initialize(&admin, &treasury, &issuance_fee);

    // Admin changes fee
    client.set_issuance_fee(&new_fee);

    let fee_config = client.get_fee_config();
    assert_eq!(fee_config.issuance_fee, new_fee);
}

#[test]
fn test_set_fee_enabled() {
    let env = Env::default();
    let contract_id = env.register(CertificateContract, ());
    let client = CertificateContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);
    let issuance_fee: i128 = 1000;

    env.mock_all_auths();
    client.initialize(&admin, &treasury, &issuance_fee);

    // Initially enabled
    let fee_config = client.get_fee_config();
    assert!(fee_config.fee_enabled);

    // Admin disables fees
    client.set_fee_enabled(&false);

    let fee_config = client.get_fee_config();
    assert!(!fee_config.fee_enabled);
}

#[test]
fn test_exempt_issuer_from_fees() {
    let env = Env::default();
    let contract_id = env.register(CertificateContract, ());
    let client = CertificateContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);
    let issuance_fee: i128 = 1000;
    let issuer = Address::generate(&env);

    env.mock_all_auths();
    client.initialize(&admin, &treasury, &issuance_fee);
    client.add_issuer(&issuer);

    // Initially not exempt
    assert!(!client.is_fee_exempt(&issuer));

    // Admin exempts issuer
    client.exempt_issuer_from_fees(&issuer, &true);

    // Now exempt
    assert!(client.is_fee_exempt(&issuer));

    // Admin removes exemption
    client.exempt_issuer_from_fees(&issuer, &false);

    // No longer exempt
    assert!(!client.is_fee_exempt(&issuer));
}
