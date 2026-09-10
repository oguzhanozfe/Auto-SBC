// ==UserScript==
// @name         Test EAFC 26 Auto SBC
// @namespace    http://tampermonkey.net/
// @version      0.1
// @description  Test script to verify Tampermonkey is working
// @author       TitiroMonkey
// @match        https://www.easports.com/*
// @match        https://www.ea.com/*
// @match        *://*/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';
    
    console.log('🔍 Test Tampermonkey script loaded!');
    console.log('🌐 Current URL:', window.location.href);
    console.log('📍 Domain:', window.location.hostname);
    
    // Create a visible test button on any page
    setTimeout(() => {
        const testButton = document.createElement('div');
        testButton.innerHTML = '🎮 AutoSBC Test - Script Active!';
        testButton.style.cssText = `
            position: fixed;
            top: 10px;
            right: 10px;
            background: #4CAF50;
            color: white;
            padding: 10px 15px;
            border-radius: 5px;
            font-weight: bold;
            z-index: 9999;
            cursor: pointer;
            font-family: Arial, sans-serif;
            box-shadow: 0 2px 10px rgba(0,0,0,0.3);
        `;
        
        testButton.addEventListener('click', () => {
            alert(`✅ Tampermonkey is working!\n\n🌐 URL: ${window.location.href}\n📍 Domain: ${window.location.hostname}\n\n🎯 The main AutoSBC script should work on EA Sports FC Ultimate Team web app pages.`);
        });
        
        document.body.appendChild(testButton);
        
        // Test server connectivity
        fetch('http://127.0.0.1:8000/allPlayers.csv')
            .then(response => {
                if (response.ok) {
                    console.log('✅ Server connection successful!');
                    testButton.innerHTML = '🎮 AutoSBC Test - Server Connected!';
                    testButton.style.background = '#2196F3';
                } else {
                    throw new Error('Server responded with error');
                }
            })
            .catch(err => {
                console.log('❌ Server connection failed:', err);
                testButton.innerHTML = '🎮 AutoSBC Test - Server Offline!';
                testButton.style.background = '#f44336';
            });
            
    }, 1000);
    
})();