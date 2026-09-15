#![no_std]
//! Insignias educativas no transferibles.
//!
//! Usa el almacenamiento base de NFT de OpenZeppelin, pero **no** expone
//! `transfer`, `transfer_from`, `approve` ni `approve_for_all`: una insignia
//! queda en la dirección que la ganó. El titular sí puede quemarla, así que
//! mostrarla es opcional.
//!
//! Solo las direcciones con el rol `issuer` otorgan insignias. Cada dirección
//! tiene como máximo una insignia de cada tipo (`kind`). Las insignias no tienen
//! valor monetario y su metadata no lleva datos personales.

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, panic_with_error, Address,
    Env, String, Symbol, TryFromVal, Val, Vec,
};
use stellar_access::access_control::{set_admin, AccessControl};
use stellar_macros::only_role;
use stellar_tokens::non_fungible::Base;

const DAY_IN_LEDGERS: u32 = 17280;
const BADGE_EXTEND_AMOUNT: u32 = 90 * DAY_IN_LEDGERS;
const BADGE_TTL_THRESHOLD: u32 = BADGE_EXTEND_AMOUNT - DAY_IN_LEDGERS;
const INSTANCE_EXTEND_AMOUNT: u32 = 90 * DAY_IN_LEDGERS;
const INSTANCE_TTL_THRESHOLD: u32 = INSTANCE_EXTEND_AMOUNT - DAY_IN_LEDGERS;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    /// La dirección ya tiene una insignia de ese tipo.
    AlreadyAwarded = 1,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    /// token_id -> tipo de insignia
    KindOf(u32),
    /// (titular, tipo) -> token_id
    BadgeOf(Address, Symbol),
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BadgeAwarded {
    #[topic]
    pub to: Address,
    #[topic]
    pub kind: Symbol,
    pub token_id: u32,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BadgeBurned {
    #[topic]
    pub owner: Address,
    #[topic]
    pub kind: Symbol,
    pub token_id: u32,
}

#[contract]
pub struct LearningBadges;

#[contractimpl]
impl LearningBadges {
    pub fn __constructor(e: &Env, admin: Address, base_uri: String, name: String, symbol: String) {
        set_admin(e, &admin);
        Base::set_metadata(e, base_uri, name, symbol);
    }

    /// Otorga a `to` una insignia de tipo `kind`. Requiere el rol `issuer` y la
    /// firma de `caller`.
    #[only_role(caller, "issuer")]
    pub fn award(e: &Env, caller: Address, to: Address, kind: Symbol) -> u32 {
        let badge_key = DataKey::BadgeOf(to.clone(), kind.clone());
        if e.storage().persistent().has(&badge_key) {
            panic_with_error!(e, Error::AlreadyAwarded);
        }

        let token_id = Base::sequential_mint(e, &to);
        let kind_key = DataKey::KindOf(token_id);
        e.storage().persistent().set(&badge_key, &token_id);
        e.storage().persistent().set(&kind_key, &kind);
        e.storage()
            .persistent()
            .extend_ttl(&badge_key, BADGE_TTL_THRESHOLD, BADGE_EXTEND_AMOUNT);
        e.storage()
            .persistent()
            .extend_ttl(&kind_key, BADGE_TTL_THRESHOLD, BADGE_EXTEND_AMOUNT);
        e.storage()
            .instance()
            .extend_ttl(INSTANCE_TTL_THRESHOLD, INSTANCE_EXTEND_AMOUNT);

        BadgeAwarded { to, kind, token_id }.publish(e);
        token_id
    }

    /// El titular borra su insignia. Después puede volver a ganarla.
    pub fn burn(e: &Env, owner: Address, token_id: u32) {
        // `Base::burn` exige la firma de `owner` y verifica que sea el titular.
        Base::burn(e, &owner, token_id);

        let kind_key = DataKey::KindOf(token_id);
        let kind: Symbol = e.storage().persistent().get(&kind_key).unwrap();
        e.storage().persistent().remove(&kind_key);
        e.storage()
            .persistent()
            .remove(&DataKey::BadgeOf(owner.clone(), kind.clone()));
        e.storage()
            .instance()
            .extend_ttl(INSTANCE_TTL_THRESHOLD, INSTANCE_EXTEND_AMOUNT);

        BadgeBurned {
            owner,
            kind,
            token_id,
        }
        .publish(e);
    }

    /// Id de la insignia de tipo `kind` que tiene `owner`, si la tiene.
    pub fn badge_of(e: &Env, owner: Address, kind: Symbol) -> Option<u32> {
        read_extending(e, &DataKey::BadgeOf(owner, kind))
    }

    /// Tipo de la insignia `token_id`, si existe.
    pub fn kind_of(e: &Env, token_id: u32) -> Option<Symbol> {
        read_extending(e, &DataKey::KindOf(token_id))
    }

    pub fn balance(e: &Env, owner: Address) -> u32 {
        Base::balance(e, &owner)
    }

    pub fn owner_of(e: &Env, token_id: u32) -> Address {
        Base::owner_of(e, token_id)
    }

    pub fn name(e: &Env) -> String {
        Base::name(e)
    }

    pub fn symbol(e: &Env) -> String {
        Base::symbol(e)
    }

    pub fn token_uri(e: &Env, token_id: u32) -> String {
        Base::token_uri(e, token_id)
    }
}

#[contractimpl(contracttrait)]
impl AccessControl for LearningBadges {}

fn read_extending<V: TryFromVal<Env, Val>>(e: &Env, key: &DataKey) -> Option<V> {
    let value = e.storage().persistent().get::<_, V>(key);
    if value.is_some() {
        e.storage()
            .persistent()
            .extend_ttl(key, BADGE_TTL_THRESHOLD, BADGE_EXTEND_AMOUNT);
    }
    value
}

mod test;
