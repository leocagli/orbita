#![cfg(test)]
extern crate std;

use super::*;
use soroban_sdk::testutils::{
    Address as _, AuthorizedFunction, AuthorizedInvocation, MockAuth, MockAuthInvoke,
};
use soroban_sdk::{IntoVal, Symbol};

fn setup<'a>() -> (Env, FamilyRegistryClient<'a>, Address, Address) {
    let e = Env::default();
    let contract_id = e.register(FamilyRegistry, ());
    let client = FamilyRegistryClient::new(&e, &contract_id);
    let parent = Address::generate(&e);
    let child = Address::generate(&e);
    (e, client, parent, child)
}

fn hash(e: &Env, byte: u8) -> BytesN<32> {
    BytesN::from_array(e, &[byte; 32])
}

fn link_active(e: &Env, client: &FamilyRegistryClient, parent: &Address, child: &Address) {
    client.propose(parent, child, &hash(e, 1), &1);
    client.accept(child, parent, &hash(e, 1), &hash(e, 2));
}

#[test]
fn parent_proposes_and_child_accepts() {
    let (e, client, parent, child) = setup();
    e.mock_all_auths();

    client.propose(&parent, &child, &hash(&e, 1), &1);
    assert_eq!(
        e.auths(),
        std::vec![(
            parent.clone(),
            AuthorizedInvocation {
                function: AuthorizedFunction::Contract((
                    client.address.clone(),
                    Symbol::new(&e, "propose"),
                    (parent.clone(), child.clone(), hash(&e, 1), 1_u32).into_val(&e),
                )),
                sub_invocations: std::vec![],
            }
        )]
    );

    let pending = client.get(&parent, &child).unwrap();
    assert_eq!(pending.status, LinkStatus::Pending);
    assert_eq!(pending.assent_hash, None);

    client.accept(&child, &parent, &hash(&e, 1), &hash(&e, 2));
    assert_eq!(
        e.auths(),
        std::vec![(
            child.clone(),
            AuthorizedInvocation {
                function: AuthorizedFunction::Contract((
                    client.address.clone(),
                    Symbol::new(&e, "accept"),
                    (child.clone(), parent.clone(), hash(&e, 1), hash(&e, 2)).into_val(&e),
                )),
                sub_invocations: std::vec![],
            }
        )]
    );

    let active = client.get(&parent, &child).unwrap();
    assert_eq!(active.status, LinkStatus::Active);
    assert_eq!(active.consent_version, 1);
    assert_eq!(active.assent_hash, Some(hash(&e, 2)));
}

#[test]
fn unknown_pair_has_no_link() {
    let (_e, client, parent, child) = setup();
    assert_eq!(client.get(&parent, &child), None);
}

#[test]
#[should_panic(expected = "Error(Auth, InvalidAction)")]
fn propose_requires_parent_signature() {
    let (e, client, parent, child) = setup();
    client.propose(&parent, &child, &hash(&e, 1), &1);
}

#[test]
#[should_panic(expected = "Error(Auth, InvalidAction)")]
fn accept_requires_child_signature() {
    let (e, client, parent, child) = setup();
    e.mock_all_auths();
    client.propose(&parent, &child, &hash(&e, 1), &1);

    // Solo firma el adulto: no alcanza para aceptar en nombre del menor.
    e.mock_auths(&[MockAuth {
        address: &parent,
        invoke: &MockAuthInvoke {
            contract: &client.address,
            fn_name: "accept",
            args: (child.clone(), parent.clone(), hash(&e, 1), hash(&e, 2)).into_val(&e),
            sub_invokes: &[],
        },
    }]);
    client.accept(&child, &parent, &hash(&e, 1), &hash(&e, 2));
}

#[test]
#[should_panic(expected = "Error(Contract, #1)")]
fn parent_cannot_link_to_itself() {
    let (e, client, parent, _child) = setup();
    e.mock_all_auths();
    client.propose(&parent, &parent, &hash(&e, 1), &1);
}

#[test]
#[should_panic(expected = "Error(Contract, #2)")]
fn cannot_accept_without_proposal() {
    let (e, client, parent, child) = setup();
    e.mock_all_auths();
    client.accept(&child, &parent, &hash(&e, 1), &hash(&e, 2));
}

#[test]
#[should_panic(expected = "Error(Contract, #6)")]
fn child_must_accept_the_proposed_consent() {
    let (e, client, parent, child) = setup();
    e.mock_all_auths();
    client.propose(&parent, &child, &hash(&e, 1), &1);
    client.accept(&child, &parent, &hash(&e, 9), &hash(&e, 2));
}

#[test]
#[should_panic(expected = "Error(Contract, #3)")]
fn cannot_accept_twice() {
    let (e, client, parent, child) = setup();
    e.mock_all_auths();
    link_active(&e, &client, &parent, &child);
    client.accept(&child, &parent, &hash(&e, 1), &hash(&e, 2));
}

#[test]
fn child_can_revoke_and_it_records_who() {
    let (e, client, parent, child) = setup();
    e.mock_all_auths();
    link_active(&e, &client, &parent, &child);

    client.revoke(&child, &parent, &child);

    let link = client.get(&parent, &child).unwrap();
    assert_eq!(link.status, LinkStatus::Revoked);
    assert_eq!(link.revoked_by, Some(child));
}

#[test]
fn parent_can_cancel_a_pending_proposal() {
    let (e, client, parent, child) = setup();
    e.mock_all_auths();
    client.propose(&parent, &child, &hash(&e, 1), &1);

    client.revoke(&parent, &parent, &child);

    let link = client.get(&parent, &child).unwrap();
    assert_eq!(link.status, LinkStatus::Revoked);
    assert_eq!(link.revoked_by, Some(parent));
}

#[test]
#[should_panic(expected = "Error(Contract, #4)")]
fn outsider_cannot_revoke() {
    let (e, client, parent, child) = setup();
    e.mock_all_auths();
    link_active(&e, &client, &parent, &child);

    let outsider = Address::generate(&e);
    client.revoke(&outsider, &parent, &child);
}

#[test]
#[should_panic(expected = "Error(Contract, #5)")]
fn cannot_revoke_twice() {
    let (e, client, parent, child) = setup();
    e.mock_all_auths();
    link_active(&e, &client, &parent, &child);

    client.revoke(&parent, &parent, &child);
    client.revoke(&child, &parent, &child);
}

#[test]
fn new_consent_needs_new_assent() {
    let (e, client, parent, child) = setup();
    e.mock_all_auths();
    link_active(&e, &client, &parent, &child);

    client.propose(&parent, &child, &hash(&e, 3), &2);

    let renewed = client.get(&parent, &child).unwrap();
    assert_eq!(renewed.status, LinkStatus::Pending);
    assert_eq!(renewed.consent_version, 2);
    assert_eq!(renewed.assent_hash, None);
    assert_eq!(renewed.accepted_at, None);

    client.accept(&child, &parent, &hash(&e, 3), &hash(&e, 4));
    assert_eq!(
        client.get(&parent, &child).unwrap().status,
        LinkStatus::Active
    );
}

#[test]
fn relinking_after_revocation_needs_the_child_again() {
    let (e, client, parent, child) = setup();
    e.mock_all_auths();
    link_active(&e, &client, &parent, &child);
    client.revoke(&child, &parent, &child);

    client.propose(&parent, &child, &hash(&e, 1), &1);

    let link = client.get(&parent, &child).unwrap();
    assert_eq!(link.status, LinkStatus::Pending);
    assert_eq!(link.revoked_by, None);
}
