#![cfg(test)]
extern crate std;

use super::*;
use soroban_sdk::testutils::{Address as _, MockAuth, MockAuthInvoke};
use soroban_sdk::{vec, IntoVal, Vec};

const BASE_URI: &str = "https://example.org/protege/badges/";
const KIND: &str = "casa_siempre_gana";

fn setup<'a>() -> (Env, LearningBadgesClient<'a>, Address, Address) {
    let e = Env::default();
    let admin = Address::generate(&e);
    let contract_id = e.register(
        LearningBadges,
        (
            admin.clone(),
            String::from_str(&e, BASE_URI),
            String::from_str(&e, "Protege Insignias"),
            String::from_str(&e, "PRTG"),
        ),
    );
    let client = LearningBadgesClient::new(&e, &contract_id);

    e.mock_all_auths();
    let issuer = Address::generate(&e);
    client.grant_role(&issuer, &Symbol::new(&e, "issuer"), &admin);

    (e, client, admin, issuer)
}

#[test]
fn issuer_awards_a_badge() {
    let (e, client, _admin, issuer) = setup();
    let kid = Address::generate(&e);
    let kind = Symbol::new(&e, KIND);

    let token_id = client.award(&issuer, &kid, &kind);

    assert_eq!(client.owner_of(&token_id), kid);
    assert_eq!(client.balance(&kid), 1);
    assert_eq!(client.badge_of(&kid, &kind), Some(token_id));
    assert_eq!(client.kind_of(&token_id), Some(kind));
    assert_eq!(client.name(), String::from_str(&e, "Protege Insignias"));
    assert_eq!(client.symbol(), String::from_str(&e, "PRTG"));

    let expected_uri = std::format!("{BASE_URI}{token_id}");
    assert_eq!(
        client.token_uri(&token_id),
        String::from_str(&e, &expected_uri)
    );
}

#[test]
#[should_panic(expected = "Error(Contract, #1)")]
fn same_kind_cannot_be_awarded_twice() {
    let (e, client, _admin, issuer) = setup();
    let kid = Address::generate(&e);
    let kind = Symbol::new(&e, KIND);

    client.award(&issuer, &kid, &kind);
    client.award(&issuer, &kid, &kind);
}

#[test]
fn kids_and_parents_collect_different_badges() {
    let (e, client, _admin, issuer) = setup();
    let kid = Address::generate(&e);
    let parent = Address::generate(&e);
    let kind = Symbol::new(&e, KIND);
    let other_kind = Symbol::new(&e, "hablar_del_tema");

    let first = client.award(&issuer, &kid, &kind);
    let second = client.award(&issuer, &kid, &other_kind);
    let parents = client.award(&issuer, &parent, &kind);

    assert_ne!(first, second);
    assert_ne!(first, parents);
    assert_eq!(client.balance(&kid), 2);
    assert_eq!(client.balance(&parent), 1);
}

#[test]
#[should_panic(expected = "Error(Contract, #2000)")]
fn outsider_cannot_award() {
    let (e, client, _admin, _issuer) = setup();
    let outsider = Address::generate(&e);
    let kid = Address::generate(&e);

    client.award(&outsider, &kid, &Symbol::new(&e, KIND));
}

#[test]
#[should_panic(expected = "Error(Contract, #2000)")]
fn admin_also_needs_the_issuer_role() {
    let (e, client, admin, _issuer) = setup();
    let kid = Address::generate(&e);

    client.award(&admin, &kid, &Symbol::new(&e, KIND));
}

#[test]
#[should_panic(expected = "Error(Contract, #2000)")]
fn revoked_issuer_cannot_award() {
    let (e, client, admin, issuer) = setup();
    let kid = Address::generate(&e);

    client.revoke_role(&issuer, &Symbol::new(&e, "issuer"), &admin);
    client.award(&issuer, &kid, &Symbol::new(&e, KIND));
}

#[test]
#[should_panic(expected = "Error(Auth, InvalidAction)")]
fn award_requires_the_issuer_signature() {
    let (e, client, _admin, issuer) = setup();
    let kid = Address::generate(&e);
    let impostor = Address::generate(&e);

    e.mock_auths(&[MockAuth {
        address: &impostor,
        invoke: &MockAuthInvoke {
            contract: &client.address,
            fn_name: "award",
            args: (issuer.clone(), kid.clone(), Symbol::new(&e, KIND)).into_val(&e),
            sub_invokes: &[],
        },
    }]);
    client.award(&issuer, &kid, &Symbol::new(&e, KIND));
}

#[test]
fn owner_can_burn_and_earn_it_again() {
    let (e, client, _admin, issuer) = setup();
    let kid = Address::generate(&e);
    let kind = Symbol::new(&e, KIND);
    let token_id = client.award(&issuer, &kid, &kind);

    client.burn(&kid, &token_id);

    assert_eq!(client.balance(&kid), 0);
    assert_eq!(client.badge_of(&kid, &kind), None);
    assert_eq!(client.kind_of(&token_id), None);

    let again = client.award(&issuer, &kid, &kind);
    assert_ne!(again, token_id);
    assert_eq!(client.balance(&kid), 1);
}

#[test]
#[should_panic(expected = "Error(Contract, #201)")]
fn others_cannot_burn_someone_elses_badge() {
    let (e, client, _admin, issuer) = setup();
    let kid = Address::generate(&e);
    let token_id = client.award(&issuer, &kid, &Symbol::new(&e, KIND));

    client.burn(&issuer, &token_id);
}

#[test]
fn badges_cannot_be_transferred() {
    let (e, client, _admin, issuer) = setup();
    let kid = Address::generate(&e);
    let friend = Address::generate(&e);
    let token_id = client.award(&issuer, &kid, &Symbol::new(&e, KIND));

    for function in ["transfer", "transfer_from", "approve", "approve_for_all"] {
        let args: Vec<Val> = vec![
            &e,
            kid.into_val(&e),
            friend.into_val(&e),
            token_id.into_val(&e),
        ];
        let result =
            e.try_invoke_contract::<(), Error>(&client.address, &Symbol::new(&e, function), args);
        assert!(result.is_err(), "{function} no debería existir");
    }

    assert_eq!(client.owner_of(&token_id), kid);
}
