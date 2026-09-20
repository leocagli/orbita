#![no_std]
//! Registro de vínculos entre un adulto responsable y un menor.
//!
//! El adulto propone el vínculo con el hash del consentimiento que firmó y el
//! menor lo acepta con el hash de su asentimiento. Cualquiera de los dos puede
//! revocarlo, y queda registrado quién lo hizo.
//!
//! Todo lo que se guarda acá es público: solo direcciones seudónimas, hashes,
//! versiones y timestamps del ledger. Nunca datos personales ni de navegación.

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, panic_with_error, Address,
    BytesN, Env,
};

// Ledgers de ~5 s. Se extiende solo cuando quedan menos de 30 días, hasta 180 días:
// escrituras baratas y ningún vínculo en uso llega a archivarse. En mainnet el TTL
// inicial ya es de ~120 días, así que el umbral recién actúa después del primer mes.
const DAY_IN_LEDGERS: u32 = 17280;
const LINK_EXTEND_AMOUNT: u32 = 180 * DAY_IN_LEDGERS;
const LINK_TTL_THRESHOLD: u32 = 30 * DAY_IN_LEDGERS;
const INSTANCE_EXTEND_AMOUNT: u32 = 180 * DAY_IN_LEDGERS;
const INSTANCE_TTL_THRESHOLD: u32 = 30 * DAY_IN_LEDGERS;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    /// El adulto y el menor no pueden ser la misma dirección.
    SameAddress = 1,
    /// No existe un vínculo para ese par.
    LinkNotFound = 2,
    /// El vínculo no está esperando aceptación.
    NotPending = 3,
    /// Solo el adulto o el menor del vínculo pueden revocarlo.
    NotParticipant = 4,
    /// El vínculo ya estaba revocado.
    AlreadyRevoked = 5,
    /// El menor intentó aceptar un consentimiento distinto del propuesto.
    ConsentMismatch = 6,
    /// La nueva versión de consentimiento no es más nueva que la vigente o pendiente.
    ConsentVersionNotIncreasing = 7,
}

#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum LinkStatus {
    Pending,
    Active,
    Revoked,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Link {
    pub status: LinkStatus,
    pub consent_hash: BytesN<32>,
    pub consent_version: u32,
    pub assent_hash: Option<BytesN<32>>,
    pub proposed_at: u64,
    pub accepted_at: Option<u64>,
    pub revoked_by: Option<Address>,
    pub revoked_at: Option<u64>,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    /// (adulto, menor)
    Link(Address, Address),
}

/// Un adulto propuso un vínculo o renovó su consentimiento.
#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LinkProposed {
    #[topic]
    pub parent: Address,
    #[topic]
    pub child: Address,
    pub consent_version: u32,
}

/// El menor aceptó el vínculo.
#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LinkAccepted {
    #[topic]
    pub parent: Address,
    #[topic]
    pub child: Address,
    pub consent_version: u32,
}

/// El adulto o el menor revocaron el vínculo.
#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LinkRevoked {
    #[topic]
    pub parent: Address,
    #[topic]
    pub child: Address,
    pub by: Address,
}

#[contract]
pub struct FamilyRegistry;

#[contractimpl]
impl FamilyRegistry {
    /// El adulto propone el vínculo con el hash del consentimiento firmado.
    ///
    /// Si el vínculo ya existía, en cualquier estado, vuelve a `Pending`: un
    /// consentimiento nuevo exige un asentimiento nuevo del menor.
    ///
    /// Mientras el vínculo está `Pending` o `Active`, la versión nueva tiene que
    /// ser mayor que la vigente: así nadie puede hacer firmar al menor un
    /// consentimiento más viejo que el que ya rigió, ni pisar una propuesta
    /// reciente con una anterior. Después de `Revoked` no hay nada que
    /// degradar, así que se puede volver a empezar con cualquier versión.
    pub fn propose(
        e: &Env,
        parent: Address,
        child: Address,
        consent_hash: BytesN<32>,
        consent_version: u32,
    ) {
        if parent == child {
            panic_with_error!(e, Error::SameAddress);
        }
        parent.require_auth();

        if let Some(existing) = read_link(e, &parent, &child) {
            if existing.status != LinkStatus::Revoked && consent_version <= existing.consent_version {
                panic_with_error!(e, Error::ConsentVersionNotIncreasing);
            }
        }

        let link = Link {
            status: LinkStatus::Pending,
            consent_hash,
            consent_version,
            assent_hash: None,
            proposed_at: e.ledger().timestamp(),
            accepted_at: None,
            revoked_by: None,
            revoked_at: None,
        };
        write_link(e, &parent, &child, &link);
        LinkProposed {
            parent,
            child,
            consent_version,
        }
        .publish(e);
    }

    /// El menor acepta el vínculo.
    ///
    /// `consent_hash` tiene que coincidir con el propuesto: si el adulto cambió
    /// el consentimiento mientras el menor firmaba, la aceptación falla.
    pub fn accept(
        e: &Env,
        child: Address,
        parent: Address,
        consent_hash: BytesN<32>,
        assent_hash: BytesN<32>,
    ) {
        child.require_auth();

        let Some(mut link) = read_link(e, &parent, &child) else {
            panic_with_error!(e, Error::LinkNotFound);
        };
        if link.status != LinkStatus::Pending {
            panic_with_error!(e, Error::NotPending);
        }
        if link.consent_hash != consent_hash {
            panic_with_error!(e, Error::ConsentMismatch);
        }

        link.status = LinkStatus::Active;
        link.assent_hash = Some(assent_hash);
        link.accepted_at = Some(e.ledger().timestamp());
        write_link(e, &parent, &child, &link);
        LinkAccepted {
            parent,
            child,
            consent_version: link.consent_version,
        }
        .publish(e);
    }

    /// El adulto o el menor revocan el vínculo. Queda registrado quién fue.
    pub fn revoke(e: &Env, by: Address, parent: Address, child: Address) {
        if by != parent && by != child {
            panic_with_error!(e, Error::NotParticipant);
        }
        by.require_auth();

        let Some(mut link) = read_link(e, &parent, &child) else {
            panic_with_error!(e, Error::LinkNotFound);
        };
        if link.status == LinkStatus::Revoked {
            panic_with_error!(e, Error::AlreadyRevoked);
        }

        link.status = LinkStatus::Revoked;
        link.revoked_by = Some(by.clone());
        link.revoked_at = Some(e.ledger().timestamp());
        write_link(e, &parent, &child, &link);
        LinkRevoked { parent, child, by }.publish(e);
    }

    /// Devuelve el vínculo entre `parent` y `child`, si existe.
    pub fn get(e: &Env, parent: Address, child: Address) -> Option<Link> {
        read_link(e, &parent, &child)
    }
}

fn read_link(e: &Env, parent: &Address, child: &Address) -> Option<Link> {
    let key = DataKey::Link(parent.clone(), child.clone());
    let link = e.storage().persistent().get::<_, Link>(&key);
    if link.is_some() {
        e.storage()
            .persistent()
            .extend_ttl(&key, LINK_TTL_THRESHOLD, LINK_EXTEND_AMOUNT);
    }
    link
}

fn write_link(e: &Env, parent: &Address, child: &Address, link: &Link) {
    let key = DataKey::Link(parent.clone(), child.clone());
    e.storage().persistent().set(&key, link);
    e.storage()
        .persistent()
        .extend_ttl(&key, LINK_TTL_THRESHOLD, LINK_EXTEND_AMOUNT);
    e.storage()
        .instance()
        .extend_ttl(INSTANCE_TTL_THRESHOLD, INSTANCE_EXTEND_AMOUNT);
}

mod test;
