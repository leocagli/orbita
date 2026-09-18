#![cfg(test)]
extern crate std;

use super::*;
use soroban_sdk::testutils::{Events, Ledger};
use soroban_sdk::{Env, Event};

#[test]
fn publica_el_hash_sin_pedir_firma() {
    let e = Env::default();
    e.ledger().set_sequence_number(1234);
    let id = e.register(Anclas, ());
    let client = AnclasClient::new(&e, &id);
    let hash = BytesN::from_array(&e, &[7; 32]);

    assert_eq!(client.ultimo(), None);
    assert_eq!(client.anclar(&hash, &3), 1234);
    assert!(e.auths().is_empty());
    assert_eq!(
        e.events().all(),
        std::vec![Anclado { hash: hash.clone(), filas: 3 }.to_xdr(&e, &id)]
    );
    assert_eq!(client.ultimo(), Some((hash, 3)));
}
