#![cfg(test)]
extern crate std;

use super::*;
use soroban_sdk::testutils::storage::Instance as _;
use soroban_sdk::testutils::{Events, Ledger};
use soroban_sdk::{Env, Event};

#[test]
fn publica_el_hash_sin_pedir_firma() {
    let e = Env::default();
    e.ledger().set_sequence_number(1234);
    let id = e.register(Anclas, ());
    let client = AnclasClient::new(&e, &id);
    let hash = BytesN::from_array(&e, &[7; 32]);

    assert_eq!(client.anclar(&hash, &3), 1234);
    assert!(e.auths().is_empty());
    assert_eq!(
        e.events().all(),
        std::vec![Anclado { hash, filas: 3 }.to_xdr(&e, &id)]
    );
}

#[test]
fn mantiene_viva_la_instancia() {
    let e = Env::default();
    let id = e.register(Anclas, ());
    let client = AnclasClient::new(&e, &id);
    client.anclar(&BytesN::from_array(&e, &[1; 32]), &1);

    let ttl = e.as_contract(&id, || e.storage().instance().get_ttl());
    assert!(ttl >= INSTANCE_TTL_THRESHOLD, "ttl de instancia: {ttl}");
}
