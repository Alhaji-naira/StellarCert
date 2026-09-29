use soroban_sdk::{Env, Address, contracterror};

#[derive(Clone, Debug, PartialEq)]
pub enum RequestStatus {
    Pending,
    Approved,
    Rejected,
    Cancelled, // New dedicated status
}

#[derive(Clone)]
pub struct Request {
    pub id: String,
    pub proposer: Address,
    pub status: RequestStatus,
}

#[derive(Debug)]
pub enum RequestError {
    Unauthorized,
    NotFound,
    InvalidStatus,
}

/// Cancel a request: only the original proposer can cancel
pub fn cancel_request(env: &Env, request: &mut Request) -> Result<(), RequestError> {
    // Only proposer can cancel
    env.invoker().require_auth().map_err(|_| RequestError::Unauthorized)?;

    // Update status to Cancelled
    request.status = RequestStatus::Cancelled;

    // Optional: emit an event
    #[allow(deprecated)]
    env.events().publish(
        ("request", "cancelled"),
        (request.proposer.clone(), request.id.clone()),
    );

    Ok(())
}

