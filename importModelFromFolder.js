// This code is WSH.JScript not a javascript


// コマンドライン引数の取得
if (WScript.Arguments.length < 1) {
	WScript.Echo("args.length=" + WScript.Arguments.length);
	WScript.Echo("Usage: runImportFromFolder.bat <path/to/mule-folder>");
	WScript.Quit(1);
}
var targetFolder = WScript.Arguments(0);
WScript.Echo("targetFolder=" + targetFolder);

//  ファイル関連の操作を提供するオブジェクトを取得
var fs = new ActiveXObject( "Scripting.FileSystemObject" );
var shell = new ActiveXObject("WScript.Shell");
// var fs = WScript.CreateObject( "Scripting.FileSystemObject" );
// var shell = WScript.CreateObject("WScript.Shell");

// flow-refの解決時に使用する
var allFlowHash = {};
var allFlowRefList = [];

WScript.Echo("EA接続前");

// リポジトリオブジェクト
var App = GetObject("", "EA.App");
var Repository = App.Repository;
var Project = Repository.GetProjectInterface();
// WScript.Echo( "Repository=" + Repository.ConnectionString );

// Get the currently selected package in the tree to work on
var thePackage ; //as EA.Package;
thePackage = Repository.GetTreeSelectedPackage();

if ( thePackage == null || thePackage.ParentID == 0 )
{
	WScript.Echo("this package can't applicable.");
	WScript.Quit();
}

var origTargetFolder = targetFolder;
searchAndCopyFolder(targetFolder, thePackage);

// for (var h of allFlowHash) {
// 	WScript.Echo( "allFlowHash[" + h + "] " + ",name=" + allFlowHash[h].name + ",guid=" + allFlowHash[h].guid);
// }

for (var i=0; i < allFlowRefList.length; i++) {
	var flowRef = allFlowRefList[i];
	WScript.Echo( "allFlowRefList[" + i + "] " + ",name=" + flowRef.name + ",guid=" + flowRef.guid 
	               + ",refFlowName=" + flowRef.refFlowName  + ",myFlowId=" + flowRef.myFlowId );
}

// flow-refが参照する先のFlowに向けて接続線を引く
soluteFlowRef();


function searchAndCopyFolder(targetFolder, packageObj) {
	// 
	var folder = fs.GetFolder(targetFolder);

	var subPackageObj;
	// 元のターゲットフォルダの値とターゲットフォルダが一致しない場合のみ
	if ( origTargetFolder != targetFolder ) {
		var slice = targetFolder.split("\\");
		subPackageObj = packageObj.Packages.AddNew(slice[slice.length-1], "Package");
		WScript.Sleep(300);
		subPackageObj.Update();
		packageObj.Update();
		packageObj.Packages.Refresh();
	} else {
		subPackageObj = packageObj;
	}

	if (folder.Files.Count > 0) {
		var emfiles = new Enumerator(folder.Files)
		for( emfiles.moveFirst(); !emfiles.atEnd(); emfiles.moveNext() ) {
			var filename = emfiles.item().Name;
			if (filename.indexOf(".xml") >= filename.length - 5) {
				// WScript.Echo("found .xml file: " + filename);
				// WScript.Echo("path: " + targetFolder);
				makeXmlPackage(targetFolder, filename, subPackageObj);
			}
		}
	}

	var emcf = new Enumerator(folder.SubFolders);
	//  格納したFileオブジェクトのサブフォルダを作成
	for( emcf.moveFirst(); !emcf.atEnd(); emcf.moveNext() ) {
		searchAndCopyFolder( targetFolder + "\\" + emcf.item().Name, subPackageObj);
	}

	// folder.Close();
	folder = null;
}


function makeXmlPackage(targetFolder, targetFile, packageObj) {
	// EA上にパッケージを作成する
	var subPackageObj = packageObj.Packages.AddNew(targetFile, "Package");
	WScript.Sleep(300);
	subPackageObj.Update();
	packageObj.Update();
	packageObj.Packages.Refresh();
	// var subPackageObj = packageObj;
	
	var jsonfile = transformXmlToJson(targetFolder, targetFile);

	WScript.Echo("jsonfile=" + jsonfile);
	importModelFromJson(jsonfile, subPackageObj);

}

function transformXmlToJson(targetFolder, targetFile) {
	//  nodeを起動してXML->JSON変換ロジックを呼び出し
	var cmdLine = "node muleModelTransform\\muleTransformToJson.js ";
	cmdLine = cmdLine + targetFolder + "\\" + targetFile + " ";
	cmdLine = cmdLine + "json-output\\" + targetFile + ".json";
	WScript.Echo("cmdLine=" + cmdLine);
	shell.Run( cmdLine, 1 );

	WScript.Sleep(500);
	return "json-output\\" + targetFile + ".json";
}


function importModelFromJson(jsonfile, packageObj)
{
	WScript.Echo("importModelFromJson() start: " + jsonfile);

	var muleapp = readJsonFile(jsonfile);
	var testElementID = 0;
	
	WScript.Echo( "Working on package '" + packageObj.Name + "' (ID=" +	packageObj.PackageID + ")" );
	
	var elements; // as EA.Collection;
	elements = packageObj.Elements;

	// flows
	for( var i=0; i < muleapp.flows.length; i++) {
		var curFlow = muleapp.flows[i];
		var flowItem = elements.AddNew( paddingZero(i+1, 2) + "_" + curFlow.name, "Activity" );
		makeFlowElement(i+1, curFlow, flowItem);

		var aflow = {name: curFlow.name, guid: flowItem.ElementGUID, type: curFlow.type,
						packageId: packageObj.PackageID};
		allFlowHash[curFlow.name] = aflow;
	}
	elements.Refresh();

	// リフレッシュ後にTreePosと名前を再セットする
	// for( var i=0; i < elements.Count; i++) {
	// 	var curFlow = muleapp.flows[i];
	// 	var flowItem = elements.GetAt(i) ;
	// 	flowItem.Name = curFlow.name;
	// 	flowItem.TreePos(i+1);
	// 	frowItem.Update();
	// }
	// elements.Refresh();


}

function makeFlowElement(seq, curFlow, flowItem) {
	flowItem.Stereotype = curFlow.type;
	flowItem.Gentype = "Java";
	flowItem.TreePos = seq;
	flowItem.Update();

	// EAで Element.Update() した後、次の処理に移るまでに少しsleepを入れる 
	WScript.Sleep(200);

	// flows.components の数だけループ 
	for (var i=0; i < curFlow.components.length; i++) {
		var curCmp = curFlow.components[i];
		var cmpItem = flowItem.Elements.AddNew(paddingZero(i+1, 2) + "_" + curCmp.name, "Action");
		makeComponentElement(i+1, curCmp, cmpItem, flowItem.ElementID);

		// flow-refの情報を記録する
		if(curCmp.type == "flow-ref") {
			var aFlowRef = {name: curCmp.name, guid: cmpItem.ElementGUID, refFlowName: curCmp.refFlowName,
			    myFlowId: flowItem.ElementID};
			allFlowRefList.push(aFlowRef);
		}
		flowItem.Elements.Refresh();
	}

	// Flowオブジェクト（Activity要素）の中にActivity Diagramを追加する
	makeInnerFlowDiagram(flowItem);
}

function makeComponentElement(seq, curCmp, cmpItem, myFlowId) {
	cmpItem.Stereotype = curCmp.type;
	cmpItem.Tag = curCmp.docid;
	cmpItem.Alias = curCmp.name;
	cmpItem.Notes = makeComponentNoteContent(curCmp);
	cmpItem.TreePos = seq;

	// さらにchildrenの中身を再帰的に作成していく
	for (var i=0; i < curCmp.children.length; i++) {
		var curCldCmp = curCmp.children[i];
		var cmpCldItem = cmpItem.Elements.AddNew(paddingZero(i+1, 2) + "_" + curCldCmp.name, "Action");
		makeComponentElement(i+1, curCldCmp, cmpCldItem, myFlowId);

		// flow-refの情報を記録する
		if(curCldCmp.type == "flow-ref") {
			var aFlowRef = { name: curCldCmp.name, guid: cmpCldItem.ElementGUID, 
				refFlowName: curCldCmp.refFlowName, myFlowId: myFlowId };
			allFlowRefList.push(aFlowRef);
		}
		cmpItem.Elements.Refresh();
	}

	cmpItem.Update();
}

function makeComponentNoteContent(curCmp) {
	var noteContent = "";
	
	if (curCmp.docid != "") {
		noteContent = noteContent + "DocId: " + curCmp.docid + "\r\n";
	}

	if (curCmp.name != "") {
		noteContent = noteContent + "Name: " + curCmp.name + "\r\n";
	}

	if (curCmp.type == "ee_set-variable") {
		noteContent = noteContent + "VariableName: " + curCmp.variableName + "\r\n";
	}
	noteContent = noteContent + "\r\n";

	switch(curCmp.type) {
		case "set-variable":
			noteContent = noteContent + convLf2Crlf(curCmp.value);
			break;
		case "ee_set-payload":
			noteContent = noteContent + convLf2Crlf(curCmp.dwtext);
			break;
		case "ee_set-variable":
			noteContent = noteContent + convLf2Crlf(curCmp.dwtext);
			break;
		case "when":
			noteContent = noteContent + "expression=" + convLf2Crlf(curCmp.expression);
			break;
	}

	return noteContent;
}


function makeInnerFlowDiagram(flowItem) {
	// flows.components-1 の数だけループしてフロー用の線を引く 
	for (var i=0; i < flowItem.Elements.Count - 1; i++) {
		var fromElemObj = flowItem.Elements.GetAt(i);
		var toElemObj = flowItem.Elements.GetAt(i+1);

		// 
		var newConn = fromElemObj.Connectors.AddNew("", "ControlFlow");
		newConn.ClientID = fromElemObj.ElementID;
		newConn.SupplierID = toElemObj.ElementID;
		newConn.Update();
		fromElemObj.Update();
		WScript.Sleep(100);
	}

	// Diagramオブジェクトを Flow要素配下に追加
	var diagItem = flowItem.Diagrams.AddNew(flowItem.Name, "Activity");
	diagItem.Update();

	// 追加されたDiagramに DiagObjを追加（ダイアグラム上にドロップするのと同じ）
	for (var i=0; i < flowItem.Elements.Count; i++) {
		var elemItem = flowItem.Elements.GetAt(i);
		var diagObjItem = diagItem.DiagramObjects.AddNew(elemItem.Name, "");
		diagObjItem.ElementID = elemItem.ElementID;
		diagObjItem.Update();
	}
	diagItem.DiagramObjects.Refresh();

	// 自動レイアウト指定
	Project.LayoutDiagramEx(diagItem.DiagramGUID, (134217728+131072), 4, 20, 20, true);
	WScript.Sleep(100);
	diagItem.Update();

	// 生成されたアクティビティ図をflow要素の子ダイアグラムとして指定する
	flowItem.SetCompositeDiagram(diagItem.DiagramGUID);

	// ダイアグラムを自動で閉じる
	Repository.CloseDiagram(diagItem.DiagramID);
}


function readJsonFile(jsonfile) {
	WScript.Echo("readJsonFile() start: " + jsonfile);
	// カレントを取得
	var jsonfilepath = shell.CurrentDirectory + "\\" + jsonfile;

	WScript.Echo("jsonfilepath=" + jsonfilepath);
	
	var streams = new ActiveXObject( "ADODB.Stream" );
	// var streams = WScript.CreateObject( "ADODB.Stream" );
	
	streams.Charset = "UTF-8";
	streams.Open();
	streams.LoadFromFile(jsonfilepath);

	var buf = streams.ReadText();
	streams.Close();
	streams = null;

	return eval("(" + buf + ")");
	// return JSON.parse(buf);
}


function soluteFlowRef() {
	for(var i=0; i<allFlowRefList.length; i++) {
		var flowRef = allFlowRefList[i];
		if (allFlowHash[flowRef.refFlowName] != null) {
			// flow-refのコンポーネントからFlowオブジェクトへの依存線
			var fromElemObj = getElementObjByGuid(flowRef.guid);
			var toElemObj = getElementObjByGuid(allFlowHash[flowRef.refFlowName].guid);
			makeConnector(fromElemObj, toElemObj);

			// flow-refのコンポーネントを保持するFlowから参照するFlowオブジェクトへの依存線
			if( typeof flowRef.myFlowId != "undefined") {
				fromElemObj = getElementObjById(flowRef.myFlowId);
				makeConnector(fromElemObj, toElemObj);

				addFlowInnerDiagram(fromElemObj, toElemObj); 

				makeInterFlowDiagram(fromElemObj, toElemObj); 
				
			} else {
				WScript.Echo( "skip for null object(from)" );
			}
		} else {
			// TODO
		}
	}
}

function makeConnector(fromElemObj, toElemObj) {
		WScript.Echo( "get from/to elem  " + "fromId=" + fromElemObj.ElementID + ",toId=" + toElemObj.ElementID );

		var newConn = fromElemObj.Connectors.AddNew("", "Dependency");
		newConn.Stereotype = "use";
		newConn.ClientID = fromElemObj.ElementID;
		newConn.SupplierID = toElemObj.ElementID;
		WScript.Sleep(200);
		newConn.Update();
		fromElemObj.Update();

		WScript.Echo( "made Connector: guid=" + newConn.ConnectorGUID + ", fromId=" + fromElemObj.ElementID + ",toId=" + toElemObj.ELementID );

}

// Flow内のダイアグラムにflow-refが参照するFlowオブジェクトを追加
function addFlowInnerDiagram(fromElemObj, toElemObj) {

	// 対象のダイアグラムを取得
	var targetDiagramObj = {};
	if (fromElemObj.Diagrams.Count > 0) {
		targetDiagramObj = fromElemObj.Diagrams.GetAt(0);
	} else {
		targetDiagramObj = fromElemObj.Diagrams.AddNew(fromElemObj.Name, "Activity");
		fromElemObj.Diagrams.Refresh();
		fromElemObj.Update();
	}

	var diaObjItem = targetDiagramObj.DiagramObjects.AddNew(toElemObj.Name, "");
	diaObjItem.ElementID = toElemObj.ElementID;
	diaObjItem.Update();

	// 自動レイアウト指定
	Project.LayoutDiagramEx(targetDiagramObj.DiagramGUID, (134217728+131072), 4, 20, 20, true);
	targetDiagramObj.Update();
	WScript.Sleep(200);
	// ダイアグラムを自動で閉じる
	Repository.CloseDiagram(targetDiagramObj.DiagramID);
}


// .xmlファイルのパッケージにダイアグラムを追加し、Flow間のflow-refによる
function makeInterFlowDiagram(fromElemObj, toElemObj) {
	var packObj = getPackageObjById(fromElemObj.PackageId);

	// 対象のダイアグラムを取得
	var targetDiagramObj = {};
	if (packObj.Diagrams.Count > 0) {
		targetDiagramObj = packObj.Diagrams.GetAt(0);
	} else {
		targetDiagramObj = packObj.Diagrams.AddNew(packObj.Name, "Activity");
		packObj.Diagrams.Refresh();
		packObj.Update();
	}

	var diaObjItem = targetDiagramObj.DiagramObjects.AddNew(fromElemObj.Name, "");
	diaObjItem.ElementID = fromElemObj.ElementID;
	diaObjItem.Update();

	diaObjItem = targetDiagramObj.DiagramObjects.AddNew(toElemObj.Name, "");
	diaObjItem.ElementID = toElemObj.ElementID;
	diaObjItem.Update();

	// 自動レイアウト指定
	Project.LayoutDiagramEx(targetDiagramObj.DiagramGUID, (134217728+524288), 4, 20, 20, true);
	targetDiagramObj.Update();
	WScript.Sleep(300);
	// ダイアグラムを自動で閉じる
	Repository.CloseDiagram(targetDiagramObj.DiagramID);
}


function getElementObjByGuid(guid) {
	return Repository.GetElementByGuid(guid);
}

function getElementObjById(id) {
	return Repository.GetElementById(id);
}

function getPackageObjById(id) {
	return Repository.GetPackageById(id);
}

function paddingZero(num, digit) {
	if (digit > 9) return "" + num;
	if (digit <= 0) return "" + num;

	var padded = "000000000" + num ;
	return padded.substring(padded.length - digit, padded.length);
}

function convLf2Crlf(str) {
	var retText = "";
	var lines = str.split("\n");
	for (var i=0; i<lines.length; i++) {
		retText = retText + lines[i] + "\r\n";
	}
	return retText;
}


