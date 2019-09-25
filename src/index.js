const puppeteer = require("puppeteer");
const readline = require("readline");
const debug = require("debug");
const KVDB = require("./db");

const md = debug("d:manager");
const bd = debug("d:browser");

const getId = () => Math.floor(Math.random() * 1000).toString(24);

const sleep = ms => new Promise(res => setTimeout(res, ms));

const pergunta = pergunta =>
  new Promise((resolve, reject) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    rl.question(pergunta, answer => {
      rl.close();
      resolve(answer);
    });
  });

(async () => {
  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: {
      height: 940,
      width: 1024
    }
  });

  const winman = new WindowManager(5);

  browser.on("targetcreated", async target => {
    bd("NEW TARGET URL: %s\ntype: %s", target.url(), target.type());
  });

  const context = browser.defaultBrowserContext();

  context.on("targetcreated", t => {
    const bc = bd.extend("context");
    bc("CREATED %s", t.url());
  });

  const page = (await browser.pages())[0];
  const pd = bd.extend("page");
  page.on("popup", async pa => {
    const id = getId();
    pd("id: %s | POPUP: %s", id, pa.url());
    const title = await pa.title();
    pd("     id: %s | title: %s", id, title);
  });

  await page.goto("https://pje.jfpe.jus.br/pje/login.seam", {
    timeout: 180000
  });

  const resp = await pergunta("Continua? (s/n) ");
  if (resp.toLowerCase() !== "s") {
    process.exit(0);
  }
  // ==> document.querySelectorAll('tr > td > div > a > img[src="/pje/img/view.gif"]')

  await winman.init(page);

  for await (const obj of iterPageLinks(page)) {
    bd(" ITERANDO ---> %s", obj.linha[2]);
    const { index, page, done } = await winman.getFreePage();
    // await page.bringToFront();
    handleLinkOnWindow(obj, index, page, done);
    bd("_ITERANDO ---> sent to page %s", obj.linha[2]);
  }
  await winman.theEnd();
  bd("FIM");
  setTimeout(() => {
    process.exit(0);
  }, 2500);
  //===> //div/div/div/table[contains(id, "")]/tbody/tr/td[text()="»"]
})();

const getInfo = async (i, page, imgSelector, manager) => {
  const deb = md.extend(`popup:${i.toString()}`);
  return new Promise(async (resolve, reject) => {
    page.once("popup", async popup1 => {
      // await manager.waitFor();
      deb("\n| PAGE NEW POPUP  URL  %s ", popup1.url());
      const btnMovimentacaoSelector =
        "div > div > form > input[id$=btnMovimentacaoProcesso]";
      popup1.once("popup", async pop2 => {
        deb("  * POPUP MOVIMENTACAO: %s", pop2.url());
        await pop2.waitForSelector("div.propertyView");
        await pop2.waitForSelector("table#processoEvento");
        // await pop2.exposeFunction("send", console.log);
        await popup1.close();
        await manager.sayIsClosed();
        const jsonStr = await pop2.evaluate(() => {
          const infos = Array.from(
            document.querySelectorAll("div.propertyView")
          ).map(div => Array.from(div.children).map(el => el.innerText));
          const processo = infos
            .filter(ar => ar[0].includes("processo"))[0][1]
            .replace(/[A-Za-z]/g, "");
          const movimentacoes = Array.from(
            document.querySelectorAll("table#processoEvento > tbody > tr")
          ).map(tr => Array.from(tr.children).map(c => c.innerText));
          const json = JSON.stringify(
            {
              infos,
              processo,
              movimentacoes
            },
            undefined,
            4
          );
          return json;
        });
        deb("JSON: %O", JSON.parse(jsonStr));
        // aqui salva...
        await pop2.close();
        manager.sayIsClosed();
        resolve(jsonStr);
      });
      const btn = await popup1.waitForSelector(btnMovimentacaoSelector);
      // await manager.waitFor();
      await btn.click();
      // console.log("clicked btn");
    });

    // await manager.waitFor();
    await page.evaluate(
      (i, sel) => {
        // console.log(i);
        const img = document.querySelectorAll(sel)[i];
        img.parentNode.parentNode.parentNode.parentNode.style.backgroundColor =
          "yellow";
        img.click();
      },
      i,
      imgSelector
    );
  });
};

const waitNextRequestFinished = page => {
  return new Promise((resolve, reject) => {
    page.once("requestfinished", req => {
      resolve();
    });
  });
};

class Manager {
  constructor(maxWins) {
    this._maxWins = maxWins;
    this._wins = 0;
    md("manager created: max: %d", this._maxWins);
    setInterval(() => {
      md("[ %d de %d ]", this._wins, this._maxWins);
    }, 5500);
  }

  loopToWait(msTime) {
    // md("  loopwait | %d de %d | INIT", this._wins, this._maxWins);
    return new Promise(resolve => {
      setTimeout(resolve, msTime);
    });
  }

  waitFor() {
    const id = Math.ceil(Math.random() * 100);
    const deb = md.extend(id.toString());
    deb("waitFor [%d] | %d de %d | INIT", id, this._wins, this._maxWins);
    return new Promise(async resolve => {
      while (true) {
        if (this._wins < this._maxWins) {
          deb(
            "waitFor [%d] | %d de %d | :) break ",
            id,
            this._wins,
            this._maxWins
          );
          break;
        }
        // deb(
        //   "waitFor [%d] | %d de %d | :) init-loop",
        //   id,
        //   this._wins,
        //   this._maxWins
        // );
        await this.loopToWait(1000);
        // deb(
        //   "waitFor [%d] | %d de %d | end-loop",
        //   id,
        //   this._wins,
        //   this._maxWins
        // );
      }

      await this.loopToWait(10 + Math.ceil(Math.random() * 100));
      deb("waitFor [%d] | %d de %d | RESOLVE", id, this._wins, this._maxWins);
      return resolve();
    });
  }

  sayIsClosed() {
    this._wins--;
    md("sayIsClosed | %d de %d", this._wins, this._maxWins);
  }

  oneMoreWindow() {
    this._wins++;
    md("oneMoreWindow | %d de %d", this._wins, this._maxWins);
  }
}

async function* iterPageLinks(page) {
  const imgSelector = 'tr > td > div > a > img[src="/pje/img/view.gif"]';
  const pageNumberCSSSelector = "tbody > tr > td.rich-datascr-act";
  const linkProxXpath =
    '//div/div/div/table[contains(id, "")]/tbody/tr/td[text()="»"]';
  while (true) {
    let linkProx = undefined;
    try {
      linkProx = await page.waitForXPath(linkProxXpath, { timeout: 5 });
    } catch (error) {
      bd("\n\napenas uma página?... %O", error);
    }
    const hasNext =
      typeof linkProx === "undefined"
        ? false
        : await page.evaluate(b => {
            return typeof b.onclick === "function";
          }, linkProx);
    const pageNumber =
      typeof linkProx === "undefined"
        ? "1"
        : await page.evaluate(
            sel => document.querySelector(sel).innerText,
            pageNumberCSSSelector
          );
    await page.evaluate(() => {
      if (!!document.querySelector("#text-span-info-painel")) {
        return;
      }
      const fixedDiv = document.createElement("div");
      fixedDiv.id = "info-fixed-div";
      const span1 = document.createElement("span");
      span1.id = "info-span-1";
      span1.innerText = "-";
      const span2 = document.createElement("span");
      span2.id = "info-span-2";
      span2.innerText = "-";
      const span3 = document.createElement("span");
      span3.id = "info-span-3";
      span3.innerText = "-";
      fixedDiv.appendChild(span1);
      fixedDiv.appendChild(span2);
      fixedDiv.appendChild(span3);
      const textSpan = document.createElement("pre");
      textSpan.appendChild(document.createTextNode("Iniciando..."));
      textSpan.id = "text-span-info-painel";
      textSpan.setAttribute(
        "style",
        "font-size: 14px; color: #deeaf4ad; overflow: hidden; padding: 0px; margin: 0px;"
      );
      const infoDiv = document.createElement("div");
      infoDiv.setAttribute(
        "style",
        "flex-direction: column; z-index: 999999999999; overflow: overlay; background-color: rgba(0, 0, 0, 0.75); padding: 18px 18px; display: flex; align-items: flex-start; justify-content: flex-start; position: absolute; left: 250px; right: 250px; top: 250px; bottom: 250px; border: 10px solid #4a75b5; 10px 10px 30px #000000cf;"
      );
      fixedDiv.setAttribute(
        "style",
        "color: palegreen; width: 100%; flex-direction: row; padding: 0px; display: flex; align-items: center; justify-content: space-between; padding-bottom: 10px; font-weight: bold; font-size: 18px;"
      );
      infoDiv.appendChild(fixedDiv);
      infoDiv.appendChild(textSpan);
      document.body.appendChild(infoDiv);
    });
    const infos = await page.evaluate(sel => {
      const imgs = Array.from(document.querySelectorAll(sel));
      const hrefs = imgs
        .map(img => img.parentNode)
        .map(n => n.onclick.toString())
        .map(t => /\'(?<g>\/pje\/Processo.*?)\'/.exec(t)[1]);
      const linhas = imgs.map(img =>
        Array.from(
          img.parentElement.parentElement.parentElement.parentElement.children
        ).map(c => c.innerText)
      );
      const paginaLinks = hrefs.map((link, index) => ({
        href: link,
        index: index,
        linha: linhas[index],
        origin: window.location.origin,
        isLastIndex: index === hrefs.length - 1,
        datetime: new Date().toISOString()
      }));
      return paginaLinks;
    }, imgSelector);
    bd("%d links.", infos.length);
    for (let i = 0; i < infos.length; i++) {
      // cada um
      const obj = {
        ...infos[i],
        pageNum: pageNumber,
        isLastPage: hasNext === false
      };
      bd(
        "\n\nPage %s, link nº %d : obj processo: %O\n\n",
        pageNumber,
        i,
        obj.linha[2]
      );
      yield obj;
    }

    bd("hasNext %s [type: %s] ", hasNext, typeof hasNext);
    if (hasNext) {
      // await page.bringToFront();
      await page.evaluate(l => l.click(), linkProx);
      await waitNextRequestFinished(page);
      bd("prox pagina carregou...");
      await page.waitFor(500);
    } else {
      bd("\n\nlastPage\n\n");
      break;
    }
  }
}

const wm = debug("d:win-man");
class WindowManager {
  constructor(numWindows) {
    this._numWindows = numWindows;
    this._windows = [];
    this._doneCount = 0;
    this._waiting_kvs = [];
    this._activeWindows = 0;
    this._sent = 0;
    this._db = new KVDB("novo.sqlite3");
    this._reportLines = [];

    wm("constructed.");
  }

  addKVToQueue(k, v) {
    this._waiting_kvs.push({
      key: k,
      value: JSON.stringify(v, undefined, 4)
    });
  }

  report(text, span1, span2, span3) {
    return new Promise(async res => {
      const array = text.split("\n").reverse();
      for (let index = 0; index < array.length; index++) {
        this._reportLines.push(array[index]);
      }
      const temp = this._reportLines.join("\n").split("\n");
      if (temp.length > 22) {
        this._reportLines.splice(0, temp.length - 22);
      }
      await this._mainPage.evaluate(text => {
        document.querySelector("#text-span-info-painel").innerText = text;
      }, [...this._reportLines].reverse().join("\n"));
      if (span1) {
        await this._mainPage.evaluate(stext => {
          document.querySelector("#info-span-1").innerText = stext;
        }, span1);
      }
      if (span2) {
        await this._mainPage.evaluate(stext => {
          document.querySelector("#info-span-2").innerText = stext;
        }, span2);
      }
      if (span3) {
        await this._mainPage.evaluate(stext => {
          document.querySelector("#info-span-3").innerText = stext;
        }, span3);
      }
      return res();
    });
  }

  maybeSaveKVs() {
    return new Promise(async resolve => {
      if (this._waiting_kvs.length >= this._numWindows) {
        await this._db.saveMany(this._waiting_kvs);
        this.report(
          `---------\nsalvos no disco: ${this._waiting_kvs
            .map(kv => kv.key)
            .join("\n\t - ")}\n-----`
        );
        this._waiting_kvs = [];
        wm("saved!");
      }
      wm("- out of maybe saved");
      resolve();
    });
  }

  saveAllKVs() {
    return new Promise(async resolve => {
      await this._db.saveMany(this._waiting_kvs);
      this.report(
        `---------\nsalvos no disco: ${this._waiting_kvs
          .map(kv => kv.key)
          .join("\n\t - ")}\n-----`
      );
      resolve();
    });
  }

  theEnd() {
    this.report("\nterminando...");
    return new Promise(async res => {
      while (this._doneCount < this._sent) {
        await sleep(1000);
      }
      wm("FIM: %d de %d", this._doneCount, this._sent);
      clearInterval(this._interval);

      const diffMs = new Date() - this._dateInit;
      const media = this._doneCount > 0 ? diffMs / 1000 / this._doneCount : 0;
      const minutos = diffMs / 1000 / 60;
      await this.report(
        `${this._doneCount} processos em ${minutos.toFixed(1)} minutos.`
      );
      await this.report(`Média: ${media.toFixed(2)} segundos/processo.`);

      await this.saveAllKVs();
      await this._db.close();

      const infos = this.calcInfo();
      await this.report("FIM :)", infos.span1, infos.span2, "FIM :)");
      res();
    });
  }

  calcInfo() {
    const diffMs = new Date() - this._dateInit;
    const media = diffMs / 1000 / this._doneCount;
    const minutos = diffMs / 1000 / 60;
    const percentagem = (this._doneCount / this._totalProcessos) * 100;
    const faltamProcessos = this._totalProcessos - this._doneCount;
    const tempoFaltaSecs = media * faltamProcessos;
    return {
      span1: `${this._doneCount} / ${
        this._totalProcessos
      } (${percentagem.toFixed(0)}%)`,
      span2: `${media.toFixed(1)} s/p [${minutos.toFixed(1)} min]`,
      span3:
        tempoFaltaSecs > 60
          ? `${(tempoFaltaSecs / 60).toFixed(0)} min`
          : `${tempoFaltaSecs.toFixed(0)} sec`
    };
  }

  init(page) {
    return new Promise(async res => {
      const browser = page.browser();
      this._mainPage = page;
      this._browser = browser;
      // await this._db.cleanDB();
      const totalProcessos = await page.evaluate(() =>
        document
          .querySelector(
            "div > div[id$=expedientesPendentesAdvogadoProcuradorDataTablePanel_body] > span"
          )
          .innerText.replace(/\D/g, "")
      );
      this._totalProcessos = parseInt(totalProcessos, 10);
      for (let index = 0; index < this._numWindows; index++) {
        const newPage = await browser.newPage();
        this._windows.push({
          page: newPage,
          number: index,
          isFree: true
        });
      }
      await this._mainPage.bringToFront();
      this._dateInit = new Date();
      this._interval = setInterval(async () => {
        const diffMs = new Date() - this._dateInit;
        const media = diffMs / 1000 / this._doneCount;
        const minutos = diffMs / 1000 / 60;
        await this.report(
          `Média: ${media.toFixed(2)} segundos/processo.\n${
            this._doneCount
          } processos em ${minutos.toFixed(1)} minutos.`
        );
      }, 1000 * 30);
      return res();
    });
  }

  createDoneFunctionForNew(winObj) {
    return async (k, v) => {
      this.addKVToQueue(k, v);

      await winObj.page.close();
      await this.maybeSaveKVs();
      // this._windows[winObj.number] = { ...winObj, isFree: true };
      this._doneCount++;
      this._activeWindows--;
      wm(
        "done function called -> index: %d | count: %d (saving... %s)",
        winObj.number,
        this._doneCount,
        k
      );
    };
  }

  createDoneFunctionForFree(winObj) {
    return async (k, v) => {
      this.addKVToQueue(k, v);
      this._windows[winObj.number] = { ...winObj, isFree: true };
      await this.maybeSaveKVs();
      this._doneCount++;
      this._activeWindows--;
      const infos = this.calcInfo();
      await this.report(
        `Info: ${this._doneCount} -> ${k} ok.`,
        infos.span1,
        infos.span2,
        infos.span3
      );
      wm(
        "done function called -> index: %d | count: %d (saving... %s)\ninfos: %O",
        winObj.number,
        this._doneCount,
        k,
        infos
      );
    };
  }

  getFreePage() {
    return new Promise(async res => {
      while (true) {
        for (const winObj of this._windows) {
          if (winObj.isFree) {
            wm(
              "free : %O",
              this._windows.map(w => ({ fri: w.isFree, i: w.number }))
            );
            this._windows[winObj.number] = { ...winObj, isFree: false };
            wm("window is free --> %d", winObj.number);
            this._activeWindows++;
            this._sent++;
            return res({
              page: winObj.page,
              index: winObj.number,
              done: this.createDoneFunctionForFree(winObj)
            });
          }
          wm(
            "wait | %O",
            this._windows.map(w => ({ fri: w.isFree, i: w.number }))
          );
          await sleep(1000);
        }
      }
    });
  }

  getNewPage() {
    return new Promise(async res => {
      const newIndex = Math.ceil(Math.random() * 10000000000000000000);
      while (true) {
        if (this._activeWindows >= this._numWindows) {
          await sleep(1000);
          continue;
        }
        const page = await this._browser.newPage();
        this._activeWindows++;
        wm("NEW window %d", newIndex);
        return res({
          page: page,
          index: newIndex,
          done: this.createDoneFunctionForNew({
            page: page,
            number: newIndex,
            isFree: true
          })
        });
      }
    });
  }
}

const deb = md.extend("janel");
const handleLinkOnWindow = async (infoObj, index, page, done) => {
  try {
    deb("0] received --> %s", infoObj.linha[2]);

    deb("1] got window %d to work with processo %s", index, infoObj.linha[2]);
    const btnMovimentacaoSelector =
      "div > div > form > input[id$=btnMovimentacaoProcesso]";
    deb("2] (%d) (%s) go assign", index, infoObj.linha[2]);
    // await page.bringToFront();
    await page.evaluate(
      end => window.location.assign(end),
      infoObj.origin + infoObj.href
    );
    deb("3] (%d) (%s) after assign", index, infoObj.linha[2]);
    // await page.waitForNavigation();

    // await page.evaluate(() => {
    //   return
    // })
    // await page.bringToFront();
    deb("4] (%d) (%s) changed popup", index, infoObj.linha[2]);
    await page.waitForSelector(btnMovimentacaoSelector);
    deb(
      "6] (%d) (%s) carregou a pagina de movimentação",
      index,
      infoObj.linha[2]
    );
    await page.evaluate(sel => {
      window.openPopUp = function(id, url) {
        window.location.assign(window.location.origin + url);
      };
      document.querySelector(sel).onclick();
    }, btnMovimentacaoSelector);
    deb("7] (%d) (%s) mudou formula", index, infoObj.linha[2]);
    // await page.bringToFront();
    // await btn.click();
    deb("8] (%d) (%s) clickou", index, infoObj.linha[2]);
    // await page.bringToFront();
    await page.waitForSelector("div.propertyView");
    await page.waitForSelector("table#processoEvento");
    deb("9] (%d) (%s) carregou movimentacoes", index, infoObj.linha[2]);
    const json = await page.evaluate(() => {
      const infos = Array.from(
        document.querySelectorAll("div.propertyView")
      ).map(div => Array.from(div.children).map(el => el.innerText));
      const processo = infos
        .filter(ar => ar[0].includes("processo"))[0][1]
        .replace(/[A-Za-z]/g, "");
      const movimentacoes = Array.from(
        document.querySelectorAll("table#processoEvento > tbody > tr")
      ).map(tr => Array.from(tr.children).map(c => c.innerText));
      const json = {
        infos,
        processo,
        movimentacoes
      };
      return json;
    });
    deb("10] (%d) (%s) tem infos... diz done...", index, infoObj.linha[2]);
    await done(json.processo, { json, infoObj });
    deb("11] (%d) (%s) disse done (fim)", index, infoObj.linha[2]);
  } catch (error) {
    deb("\n\n\nERROR\n\n\n%O\n\n\n", error);
    deb("--------");
    deb("Index: %s from page %s", index, page);
    deb("--------");
  }
};
