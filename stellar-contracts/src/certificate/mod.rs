pub mod propose;

pub use propose::{propose_certificate, CertificateData, CertificateError};

#[cfg(test)]
mod tests;
