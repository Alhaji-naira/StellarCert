#![no_std]
mod request;
pub use request::{Request, RequestStatus};

use soroban_sdk::{contractimpl, Env, Address};

pub struct RequestModule;

#[contractimpl]
impl RequestModule {
    pub fn new_request(env: Env, id: u32, proposer: Address) -> Request {
        Request::new(id, proposer)
    }

    pub fn cancel_request(env: Env, mut req: Request, caller: Address) -> Request {
        req.cancel(&caller).unwrap();
        req
    }

    pub fn reject_request(mut req: Request) -> Request {
        req.reject();
        req
    }

    pub fn approve_request(mut req: Request) -> Request {
        req.approve();
        req
    }

    pub fn get_status(req: Request) -> RequestStatus {
        req.status()
    }
}
