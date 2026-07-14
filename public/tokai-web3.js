/**
 * TOKAI RWA — Web3 Integration Layer v1.0
 *
 * Propósito:
 *   Corrige los desfases entre los ABIs hardcodeados en el frontend
 *   y los contratos reales desplegados. Provee window.TOKAI_WEB3 con
 *   las implementaciones correctas de todas las operaciones on-chain.
 *
 * Carga:
 *   1. contracts.js         → window.__DEPLOYMENT__ (addresses + ABIs reales)
 *   2. tokai-web3.js        → window.TOKAI_WEB3 (este archivo)
 *
 * Uso en el frontend:
 *   const result = await window.TOKAI_WEB3.deployToken(project, signer);
 *   const result = await window.TOKAI_WEB3.createOrder(tokenAddr, amount, priceUsdc, signer);
 *   const result = await window.TOKAI_WEB3.claimYield(tokenAddr, signer);
 */

(function () {
  'use strict';

  // ─── Helpers internos ────────────────────────────────────────────────────────

  function dep() {
    return window.__DEPLOYMENT__;
  }

  function abis() {
    return dep()?.abis || {};
  }

  function ethers() {
    return window.ethers;
  }

  function contract(address, abiName, signer) {
    if (!address) throw new Error(`[TOKAI_WEB3] Dirección nula para ${abiName}`);
    const abi = abis()[abiName];
    if (!abi) throw new Error(`[TOKAI_WEB3] ABI no encontrado para ${abiName}`);
    return new (ethers().Contract)(address, abi, signer);
  }

  function isLive() {
    return !!(dep() && dep().tokenFactory && window.ethereum);
  }

  function deployEvidence(tx, receipt) {
    const deployment = dep() || {};
    return {
      tokenDeployTxHash: tx.hash,
      tokenFactoryAddress: deployment.tokenFactory,
      tokenDeployEvent: 'ProjectDeployed',
      tokenDeployNetwork: deployment.network || null,
      tokenDeployChainId: deployment.chainId || null,
      tokenDeployBlockNumber: receipt.blockNumber,
    };
  }

  // ─── 1. KYC — IdentityRegistry ───────────────────────────────────────────────

  /**
   * Registra o actualiza identidad de un inversor.
   * Contrato real: registerIdentity(investor, jurisdiction_, category_) — 3 args
   * Bug frontend:  registerIdentity(addr, jur, cat, kycHash)            — 4 args (INCORRECTO)
   */
  async function registerIdentity(investorAddr, jurisdiction, category, signer) {
    if (!isLive()) return { ok: false, reason: 'Sistema en modo demo' };

    const registry = contract(dep().identityRegistry, 'IdentityRegistry', signer);
    const tx = await registry.registerIdentity(investorAddr, jurisdiction, category);
    const receipt = await tx.wait();
    return { ok: true, hash: tx.hash, blockNumber: receipt.blockNumber };
  }

  async function revokeIdentity(investorAddr, signer) {
    if (!isLive()) return { ok: false, reason: 'Sistema en modo demo' };

    const registry = contract(dep().identityRegistry, 'IdentityRegistry', signer);
    const tx = await registry.revokeIdentity(investorAddr);
    await tx.wait();
    return { ok: true, hash: tx.hash };
  }

  async function isVerified(investorAddr, tokenRegistryAddr) {
    if (!isLive()) return false;

    const registryAddr = tokenRegistryAddr || dep().identityRegistry;
    const registry = contract(registryAddr, 'IdentityRegistry', ethers().getDefaultProvider());
    return registry.isVerified(investorAddr);
  }

  // ─── 2. Deploy de tokens — TokenFactory ──────────────────────────────────────

  /**
   * Despliega un token ERC-3643 vía TokenFactory.
   * Contrato real: deployERC3643(name_, symbol_, maxSupply_, priceUsdCents_, admin_) — 5 args
   * Bug frontend:  deployToken(name, symbol, maxSupply)                               — 3 args (INCORRECTO)
   *
   * @param {object} project - { name, symbol, maxSupply, priceUsdCents, adminAddress }
   * @param {ethers.Signer} signer
   */
  async function deployERC3643(project, signer) {
    if (!isLive()) return { ok: false, reason: 'Sistema en modo demo' };

    const factory = contract(dep().tokenFactory, 'TokenFactory', signer);
    const tx = await factory.deployERC3643(
      project.name,
      project.symbol,
      ethers().parseEther(String(project.maxSupply || 1_000_000)),
      BigInt(project.priceUsdCents || 10_000),  // $100 = 10000 centavos
      project.adminAddress || await signer.getAddress()
    );
    const receipt = await tx.wait();

    // Parsear evento ProjectDeployed
    const iface = new (ethers().Interface)(abis().TokenFactory);
    let tokenAddr = null, registryAddr = null, projectId = null;
    for (const log of receipt.logs) {
      try {
        const parsed = iface.parseLog(log);
        if (parsed?.name === 'ProjectDeployed') {
          projectId   = Number(parsed.args[0]);
          tokenAddr   = parsed.args[2];
          registryAddr= parsed.args[3];
          break;
        }
      } catch { /* ignorar logs de otros contratos */ }
    }

    return {
      ok: true,
      hash: tx.hash,
      tokenAddr,
      registryAddr,
      projectId,
      blockNumber: receipt.blockNumber,
      deployEvidence: deployEvidence(tx, receipt),
    };
  }

  async function deployERC4626(project, signer) {
    if (!isLive()) return { ok: false, reason: 'Sistema en modo demo' };

    const factory = contract(dep().tokenFactory, 'TokenFactory', signer);
    const adminAddr = project.adminAddress || await signer.getAddress();
    const tx = await factory.deployERC4626(project.name, project.symbol, adminAddr);
    const receipt = await tx.wait();

    const iface = new (ethers().Interface)(abis().TokenFactory);
    let tokenAddr = null, registryAddr = null;
    for (const log of receipt.logs) {
      try {
        const parsed = iface.parseLog(log);
        if (parsed?.name === 'ProjectDeployed') {
          tokenAddr = parsed.args[2]; registryAddr = parsed.args[3]; break;
        }
      } catch { /* */ }
    }
    return { ok: true, hash: tx.hash, tokenAddr, registryAddr, deployEvidence: deployEvidence(tx, receipt) };
  }

  async function deployERC7540(project, signer) {
    if (!isLive()) return { ok: false, reason: 'Sistema en modo demo' };

    const factory = contract(dep().tokenFactory, 'TokenFactory', signer);
    const adminAddr = project.adminAddress || await signer.getAddress();
    const tx = await factory.deployERC7540(project.name, project.symbol, adminAddr);
    const receipt = await tx.wait();

    const iface = new (ethers().Interface)(abis().TokenFactory);
    let tokenAddr = null, registryAddr = null;
    for (const log of receipt.logs) {
      try {
        const parsed = iface.parseLog(log);
        if (parsed?.name === 'ProjectDeployed') {
          tokenAddr = parsed.args[2]; registryAddr = parsed.args[3]; break;
        }
      } catch { /* */ }
    }
    return { ok: true, hash: tx.hash, tokenAddr, registryAddr, deployEvidence: deployEvidence(tx, receipt) };
  }

  async function deployERC5192(project, signer) {
    if (!isLive()) return { ok: false, reason: 'Sistema en modo demo' };

    const factory = contract(dep().tokenFactory, 'TokenFactory', signer);
    const adminAddr = project.adminAddress || await signer.getAddress();
    const tx = await factory.deployERC5192(
      project.name,
      project.symbol,
      BigInt(project.maxSupply || 10_000),
      project.baseURI || 'ipfs://',
      adminAddr
    );
    const receipt = await tx.wait();

    const iface = new (ethers().Interface)(abis().TokenFactory);
    let tokenAddr = null;
    for (const log of receipt.logs) {
      try {
        const parsed = iface.parseLog(log);
        if (parsed?.name === 'ProjectDeployed') { tokenAddr = parsed.args[2]; break; }
      } catch { /* */ }
    }
    return { ok: true, hash: tx.hash, tokenAddr, deployEvidence: deployEvidence(tx, receipt) };
  }

  async function deployERC1155(project, signer) {
    if (!isLive()) return { ok: false, reason: 'Sistema en modo demo' };

    const factory = contract(dep().tokenFactory, 'TokenFactory', signer);
    const adminAddr = project.adminAddress || await signer.getAddress();
    const tx = await factory.deployERC1155(
      project.baseURI || 'ipfs://',
      project.name,
      project.symbol,
      adminAddr
    );
    const receipt = await tx.wait();

    const iface = new (ethers().Interface)(abis().TokenFactory);
    let tokenAddr = null;
    for (const log of receipt.logs) {
      try {
        const parsed = iface.parseLog(log);
        if (parsed?.name === 'ProjectDeployed') { tokenAddr = parsed.args[2]; break; }
      } catch { /* */ }
    }
    return { ok: true, hash: tx.hash, tokenAddr, deployEvidence: deployEvidence(tx, receipt) };
  }

  /** Router unificado — el frontend llama deployToken(project, signer) y este módulo elige */
  async function deployToken(project, signer) {
    const std = (project.standard || 'ERC-3643').toUpperCase().replace('-', '');
    if (std.includes('3643')) return deployERC3643(project, signer);
    if (std.includes('4626')) return deployERC4626(project, signer);
    if (std.includes('7540')) return deployERC7540(project, signer);
    if (std.includes('1155')) return deployERC1155(project, signer);
    if (std.includes('5192')) return deployERC5192(project, signer);
    return { ok: false, reason: `Estándar no soportado: ${project.standard}` };
  }

  // ─── 2b. Deploy de Infraestructura — desde el Panel TOKAI ────────────────────
  //
  // Despliega TokenFactory + 5 sub-factories + cableado setFactory* en la red destino.
  // Llamado desde la sub-pestaña "Infraestructura" del panel admin.
  // NO se ejecuta scripts de terminal — todo lo firma MetaMask en el browser.
  //
  // Prerrequisito: window.__TOKAI_BYTECODES__ debe estar disponible
  //               (inyectado por build-front.js desde los artifacts de Hardhat).
  //
  // @param {object} params - { usdcAddress, adminAddress, network, chainId }
  // @param {ethers.Signer} signer - signer de MetaMask (wallet 0x110a...3976)
  // @returns {object} - { ok, addresses: { tokenFactory, erc3643, ... }, txHashes, error? }

  async function deployInfrastructure(params, signer) {
    const bc = window.__TOKAI_BYTECODES__;
    if (!bc) {
      return { ok: false, reason: 'window.__TOKAI_BYTECODES__ no disponible. Ejecuta node build-front.js primero.' };
    }
    if (!window.ethereum) {
      return { ok: false, reason: 'MetaMask no detectado.' };
    }

    const { usdcAddress, adminAddress } = params;
    if (!usdcAddress || !adminAddress) {
      return { ok: false, reason: 'usdcAddress y adminAddress son requeridos.' };
    }

    const E = ethers();
    const ContractFactory = E.ContractFactory;

    const log = (msg) => console.log(`[TOKAI_WEB3 deployInfra] ${msg}`);
    const addresses  = {};
    const txHashes   = {};
    const blockNums  = {};

    try {
      // ── 1. Deploy ERC3643Factory ──────────────────────────────────────────
      log('Desplegando ERC3643Factory…');
      const f3643 = new ContractFactory(bc.ERC3643Factory.abi, bc.ERC3643Factory.bytecode, signer);
      const c3643 = await f3643.deploy(usdcAddress, adminAddress);
      const r3643 = await c3643.deploymentTransaction().wait();
      addresses.erc3643 = await c3643.getAddress();
      txHashes.erc3643  = r3643.hash;
      blockNums.erc3643 = r3643.blockNumber;
      log(`ERC3643Factory → ${addresses.erc3643}`);

      // ── 2. Deploy ERC4626Factory ──────────────────────────────────────────
      log('Desplegando ERC4626Factory…');
      const f4626 = new ContractFactory(bc.ERC4626Factory.abi, bc.ERC4626Factory.bytecode, signer);
      const c4626 = await f4626.deploy(usdcAddress, adminAddress);
      const r4626 = await c4626.deploymentTransaction().wait();
      addresses.erc4626 = await c4626.getAddress();
      txHashes.erc4626  = r4626.hash;
      log(`ERC4626Factory → ${addresses.erc4626}`);

      // ── 3. Deploy ERC7540Factory ──────────────────────────────────────────
      log('Desplegando ERC7540Factory…');
      const f7540 = new ContractFactory(bc.ERC7540Factory.abi, bc.ERC7540Factory.bytecode, signer);
      const c7540 = await f7540.deploy(usdcAddress, adminAddress);
      const r7540 = await c7540.deploymentTransaction().wait();
      addresses.erc7540 = await c7540.getAddress();
      txHashes.erc7540  = r7540.hash;
      log(`ERC7540Factory → ${addresses.erc7540}`);

      // ── 4. Deploy ERC1155Factory ──────────────────────────────────────────
      log('Desplegando ERC1155Factory…');
      const f1155 = new ContractFactory(bc.ERC1155Factory.abi, bc.ERC1155Factory.bytecode, signer);
      const c1155 = await f1155.deploy(adminAddress);
      const r1155 = await c1155.deploymentTransaction().wait();
      addresses.erc1155 = await c1155.getAddress();
      txHashes.erc1155  = r1155.hash;
      log(`ERC1155Factory → ${addresses.erc1155}`);

      // ── 5. Deploy ERC5192Factory ──────────────────────────────────────────
      log('Desplegando ERC5192Factory…');
      const f5192 = new ContractFactory(bc.ERC5192Factory.abi, bc.ERC5192Factory.bytecode, signer);
      const c5192 = await f5192.deploy(adminAddress);
      const r5192 = await c5192.deploymentTransaction().wait();
      addresses.erc5192 = await c5192.getAddress();
      txHashes.erc5192  = r5192.hash;
      log(`ERC5192Factory → ${addresses.erc5192}`);

      // ── 6. Deploy TokenFactory (orquestador) ─────────────────────────────
      log('Desplegando TokenFactory…');
      const fTF = new ContractFactory(bc.TokenFactory.abi, bc.TokenFactory.bytecode, signer);
      const cTF = await fTF.deploy(usdcAddress, adminAddress);
      const rTF = await cTF.deploymentTransaction().wait();
      addresses.tokenFactory = await cTF.getAddress();
      txHashes.tokenFactory  = rTF.hash;
      blockNums.tokenFactory = rTF.blockNumber;
      log(`TokenFactory → ${addresses.tokenFactory}`);

      // ── 7. Cablear sub-factories en TokenFactory ──────────────────────────
      log('Cableando sub-factories…');
      const tf = new (E.Contract)(addresses.tokenFactory, bc.TokenFactory.abi, signer);

      const txSet3643 = await tf.setFactory3643(addresses.erc3643); await txSet3643.wait();
      const txSet4626 = await tf.setFactory4626(addresses.erc4626); await txSet4626.wait();
      const txSet7540 = await tf.setFactory7540(addresses.erc7540); await txSet7540.wait();
      const txSet1155 = await tf.setFactory1155(addresses.erc1155); await txSet1155.wait();
      const txSet5192 = await tf.setFactory5192(addresses.erc5192); await txSet5192.wait();
      log('Sub-factories cableadas ✓');

      return {
        ok: true,
        addresses,
        txHashes,
        blockNumbers: blockNums,
        deployTxHash:    txHashes.tokenFactory,
        deployBlockNumber: blockNums.tokenFactory,
        deployedBy:      adminAddress,
      };

    } catch (err) {
      console.error('[TOKAI_WEB3 deployInfra] Error:', err);
      return {
        ok: false,
        reason: err.reason || err.message || 'Error desconocido en el deploy',
        addresses,    // parcial — lo que llegó a desplegarse
        txHashes,
      };
    }
  }


  // ─── 3. Emisión — TOKAIToken ──────────────────────────────────────────────────

  /**
   * Mint de tokens.
   * Contrato real: mint(to, amount)         — 2 args
   * Bug frontend:  mint(to, amount, serieId) — 3 args (INCORRECTO)
   */
  async function mint(tokenAddr, toAddr, amount, signer) {
    if (!isLive()) return { ok: false, reason: 'Sistema en modo demo' };

    const token = contract(tokenAddr, 'TOKAIToken', signer);
    const tx = await token.mint(toAddr, ethers().parseEther(String(amount)));
    await tx.wait();
    return { ok: true, hash: tx.hash };
  }

  /**
   * Habilitar / deshabilitar emisión.
   * Contrato real: enableEmission(bool)      — 1 arg bool
   * Bug frontend:  enableEmission(serieId)   — arg incorrecto
   */
  async function setEmission(tokenAddr, enabled, signer) {
    if (!isLive()) return { ok: false, reason: 'Sistema en modo demo' };

    const token = contract(tokenAddr, 'TOKAIToken', signer);
    const tx = await token.enableEmission(enabled);
    await tx.wait();
    return { ok: true, hash: tx.hash };
  }

  // ─── 4. Yield — TOKAIToken / YieldDistributor ─────────────────────────────────

  async function claimableYield(tokenAddr, investorAddr, provider) {
    if (!isLive()) return 0n;

    const token = contract(tokenAddr, 'TOKAIToken', provider);
    return token.claimableYield(investorAddr);
  }

  async function claimYield(tokenAddr, signer) {
    if (!isLive()) return { ok: false, reason: 'Sistema en modo demo' };

    const token = contract(tokenAddr, 'TOKAIToken', signer);
    const tx = await token.claimYield();
    const receipt = await tx.wait();

    // Leer monto del evento YieldClaimed
    const iface = new (ethers().Interface)(abis().TOKAIToken);
    let amount = 0n;
    for (const log of receipt.logs) {
      try {
        const parsed = iface.parseLog(log);
        if (parsed?.name === 'YieldClaimed') { amount = parsed.args[1]; break; }
      } catch { /* */ }
    }

    // Gas en POL
    const gasUsed = receipt.gasUsed;
    const gasPrice = receipt.gasPrice || receipt.effectiveGasPrice || 0n;
    const gasPOL = ethers().formatEther(gasUsed * gasPrice);

    return {
      ok: true,
      hash: tx.hash,
      amount,                                  // en USDC (6 decimales)
      amountFormatted: ethers().formatUnits(amount, 6),
      gasPOL,
    };
  }

  // ─── 5. OTC Market — IMPLEMENTACIÓN COMPLETA ─────────────────────────────────
  // El frontend tenía stubs vacíos. Aquí está la integración real.

  /**
   * Crea una orden de venta OTC.
   * El vendedor debe haber aprobado el OTCMarket para `amount` tokens antes.
   *
   * @param {string}        tokenAddr  - Dirección del token a vender
   * @param {bigint|string} amount     - Cantidad de tokens (en wei / 18 decimales)
   * @param {bigint|string} priceUsdc  - Precio total en USDC (6 decimales)
   * @param {ethers.Signer} signer
   */
  async function createOrder(tokenAddr, amount, priceUsdc, signer) {
    if (!isLive()) return { ok: false, reason: 'Sistema en modo demo' };

    const otc = contract(dep().otcMarket, 'OTCMarket', signer);

    // Aprobar OTCMarket para tomar el token en escrow
    const token = contract(tokenAddr, 'TOKAIToken', signer);
    const approveTx = await token.approve(dep().otcMarket, amount);
    await approveTx.wait();

    const tx = await otc.createOrder(tokenAddr, amount, priceUsdc);
    const receipt = await tx.wait();

    // Parsear orderId del evento OrderCreated
    const iface = new (ethers().Interface)(abis().OTCMarket);
    let orderId = null;
    for (const log of receipt.logs) {
      try {
        const parsed = iface.parseLog(log);
        if (parsed?.name === 'OrderCreated') { orderId = parsed.args[0]; break; }
      } catch { /* */ }
    }

    return { ok: true, hash: tx.hash, orderId };
  }

  /**
   * Compra los tokens de una orden OTC.
   * El comprador debe haber aprobado el OTCMarket para `priceUsdc` USDC antes.
   *
   * @param {string}        orderId  - bytes32 del ID de la orden
   * @param {bigint|string} priceUsdc - Precio total de la orden (para el approve)
   * @param {ethers.Signer} signer
   */
  async function fillOrder(orderId, priceUsdc, signer) {
    if (!isLive()) return { ok: false, reason: 'Sistema en modo demo' };

    const otc = contract(dep().otcMarket, 'OTCMarket', signer);

    // Aprobar USDC para el OTCMarket
    const usdc = new (ethers().Contract)(
      dep().usdc,
      ['function approve(address,uint256) returns(bool)'],
      signer
    );
    const approveTx = await usdc.approve(dep().otcMarket, priceUsdc);
    await approveTx.wait();

    const tx = await otc.fillOrder(orderId);
    const receipt = await tx.wait();

    return { ok: true, hash: tx.hash, blockNumber: receipt.blockNumber };
  }

  /**
   * El vendedor cancela su orden y recupera los tokens del escrow.
   */
  async function cancelOrder(orderId, signer) {
    if (!isLive()) return { ok: false, reason: 'Sistema en modo demo' };

    const otc = contract(dep().otcMarket, 'OTCMarket', signer);
    const tx = await otc.cancelOrder(orderId);
    await tx.wait();
    return { ok: true, hash: tx.hash };
  }

  /**
   * Lee una orden del OTCMarket (view — sin signer).
   */
  async function getOrder(orderId, provider) {
    if (!isLive()) return null;

    const otc = contract(dep().otcMarket, 'OTCMarket', provider);
    const order = await otc.getOrder(orderId);
    return {
      seller:    order.seller,
      token:     order.token,
      amount:    order.amount,
      priceUsdc: order.priceUsdc,
      createdAt: Number(order.createdAt),
      status:    Number(order.status), // 0=Active 1=Filled 2=Cancelled
    };
  }

  /**
   * Lista las órdenes activas con paginación.
   */
  async function getActiveOrders(offset, limit, provider) {
    if (!isLive()) return { ids: [], orders: [], total: 0n };

    const otc = contract(dep().otcMarket, 'OTCMarket', provider);
    const [ids, orders, total] = await otc.getActiveOrders(BigInt(offset), BigInt(limit));
    return {
      ids,
      orders: orders.map(o => ({
        seller:    o.seller,
        token:     o.token,
        amount:    o.amount,
        priceUsdc: o.priceUsdc,
        createdAt: Number(o.createdAt),
        status:    Number(o.status),
      })),
      total,
    };
  }

  /**
   * Órdenes de un vendedor específico.
   */
  async function getOrdersBySeller(sellerAddr, offset, limit, provider) {
    if (!isLive()) return { ids: [], orders: [], total: 0n };

    const otc = contract(dep().otcMarket, 'OTCMarket', provider);
    const [ids, orders, total] = await otc.getOrdersBySeller(
      sellerAddr, BigInt(offset), BigInt(limit)
    );
    return {
      ids,
      orders: orders.map(o => ({
        seller:    o.seller,
        token:     o.token,
        amount:    o.amount,
        priceUsdc: o.priceUsdc,
        createdAt: Number(o.createdAt),
        status:    Number(o.status),
      })),
      total,
    };
  }

  // ─── 6. Proyectos — TokenFactory (lectura) ────────────────────────────────────

  /**
   * Lee la cantidad de proyectos desplegados.
   */
  async function projectCount(provider) {
    if (!isLive()) return 0n;
    const factory = contract(dep().tokenFactory, 'TokenFactory', provider);
    return factory.projectCount();
  }

  /**
   * Lee un proyecto por ID.
   * Contrato real: getProject(id) → (token, registry, admin, standard, symbol, deployedAt)
   * Bug frontend:  projects(index) → (name, token, compliance)  [INCORRECTO]
   */
  async function getProject(projectId, provider) {
    if (!isLive()) return null;
    const factory = contract(dep().tokenFactory, 'TokenFactory', provider);
    const p = await factory.getProject(BigInt(projectId));
    return {
      token:      p.token,
      registry:   p.registry,
      admin:      p.admin,
      standard:   p.standard,
      symbol:     p.symbol,
      deployedAt: Number(p.deployedAt),
    };
  }

  async function getProjects(offset, limit, provider) {
    if (!isLive()) return [];
    const factory = contract(dep().tokenFactory, 'TokenFactory', provider);
    const records = await factory.getProjects(BigInt(offset), BigInt(limit));
    return records.map(p => ({
      token:      p.token,
      registry:   p.registry,
      admin:      p.admin,
      standard:   p.standard,
      symbol:     p.symbol,
      deployedAt: Number(p.deployedAt),
    }));
  }

  // ─── 7. Inicialización — parchear window.__ABIS__ ────────────────────────────

  /**
   * Si window.__DEPLOYMENT__ ya está disponible (cargado por contracts.js),
   * parchea window.__ABIS__ con los ABIs correctos para que el frontend legacy
   * use los correctos en lugar de los desactualizados hardcodeados.
   */
  function patchLegacyAbis() {
    const deployment = window.__DEPLOYMENT__;
    if (!deployment?.abis) return;

    window.__ABIS__ = window.__ABIS__ || {};
    // Sobreescribir los ABIs incorrectos con los reales
    Object.assign(window.__ABIS__, {
      TokenFactory:    deployment.abis.TokenFactory,
      TOKAIToken:      deployment.abis.TOKAIToken,
      TOKAIVault:      deployment.abis.TOKAIVault,
      TOKAIAsyncVault: deployment.abis.TOKAIAsyncVault,
      TOKAIMultiToken: deployment.abis.TOKAIMultiToken,
      TOKAISoulbound:  deployment.abis.TOKAISoulbound,
      IdentityRegistry:deployment.abis.IdentityRegistry,
      OTCMarket:       deployment.abis.OTCMarket,
      YieldDistributor:deployment.abis.YieldDistributor,
      // Aliases para compatibilidad con nombres legacy del frontend
      TREXToken:       deployment.abis.TOKAIToken,
      TokenizedVault:  deployment.abis.TOKAIVault,
      AsyncVault:      deployment.abis.TOKAIAsyncVault,
      MultiToken:      deployment.abis.TOKAIMultiToken,
      SoulboundToken:  deployment.abis.TOKAISoulbound,
    });
    console.log('[TOKAI_WEB3] ABIs actualizados con contratos reales ✓');
  }

  // ─── 8. Carga asíncrona desde el backend (opcional) ──────────────────────────

  /**
   * Si NO hay contracts.js cargado (no hay window.__DEPLOYMENT__),
   * intenta cargar la configuración desde el backend.
   * El frontend puede llamar TOKAI_WEB3.init() al arrancar.
   */
  async function init() {
    if (window.__DEPLOYMENT__) {
      patchLegacyAbis();
      console.log('[TOKAI_WEB3] Usando window.__DEPLOYMENT__ de contracts.js ✓');
      return true;
    }

    // Intentar cargar desde el backend
    const apiUrl = window.__API_URL__ || 'https://api.tokairwa.com/api/v1';
    try {
      const res = await fetch(`${apiUrl}/contracts`);
      const data = await res.json();
      if (data.configured && data.deployment) {
        // El backend solo tiene addresses, no ABIs — los ABIs vienen de este archivo
        // Para Amoy/mainnet, los ABIs son los mismos (mismo código)
        window.__DEPLOYMENT__ = {
          ...data.deployment,
          abis: window.__ABIS__,  // usar los que ya están en el HTML
        };
        console.log('[TOKAI_WEB3] Configuración cargada desde backend ✓', data.deployment.network);
        return true;
      }
    } catch (e) {
      console.warn('[TOKAI_WEB3] Backend no disponible, modo demo activo', e.message);
    }
    return false;
  }

  // ─── Exportar API pública ────────────────────────────────────────────────────

  window.TOKAI_WEB3 = {
    // Estado
    isLive,
    init,

    // KYC
    registerIdentity,
    revokeIdentity,
    isVerified,

    // Deploy
    deployToken,
    deployERC3643,
    deployERC4626,
    deployERC7540,
    deployERC1155,
    deployERC5192,
    deployInfrastructure,    // Deploy de TokenFactory + sub-factories desde el panel admin

    // Token ops
    mint,
    setEmission,

    // Yield
    claimableYield,
    claimYield,

    // OTC Market (NUEVO — antes era stub vacío)
    createOrder,
    fillOrder,
    cancelOrder,
    getOrder,
    getActiveOrders,
    getOrdersBySeller,

    // Factory reads
    projectCount,
    getProject,
    getProjects,
  };

  // Auto-init si contracts.js ya fue cargado antes que este script
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', patchLegacyAbis);
  } else {
    patchLegacyAbis();
  }

  console.log('[TOKAI_WEB3] Web3 Integration Layer v1.0 cargado ✓');

})();
