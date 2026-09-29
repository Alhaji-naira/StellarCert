use soroban_sdk::{Env, Address};

#[derive(Clone, Copy)]
pub enum RequestStatus {
    Pending,
    Approved,
    Rejected,
    Cancelled, // dedicated cancelled state
}

#[derive(Clone)]
pub struct Request {
    pub id: u32,
    pub proposer: Address,
    pub status: RequestStatus,
}

impl Request {
    pub fn new(id: u32, proposer: Address) -> Self {
        Self {
            id,
            proposer,
            status: RequestStatus::Pending,
        }
    }

    /// Explicitly cancel request (only proposer can cancel)
    pub fn cancel(&mut self, caller: &Address) -> Result<(), &'static str> {
        if *caller != self.proposer {
            return Err("Only proposer can cancel the request");
        }
        self.status = RequestStatus::Cancelled;
        Ok(())
    }

    /// Reject request (signers/multisig)
    pub fn reject(&mut self) {
        self.status = RequestStatus::Rejected;
    }

    /// Approve request
    pub fn approve(&mut self) {
        self.status = RequestStatus::Approved;
    }

    /// Query current status
    pub fn status(&self) -> RequestStatus {
        self.status
    }
}
